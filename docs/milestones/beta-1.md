# Beta — a family that isn't Ray's can use mat-plan

> **Status: proposed 2026-09-30, awaiting Ray's review.** A cross-PR milestone, not an implementation
> plan: every row still gets its own branch, PR, and (where significant) plan and panels. The rows are
> filed in [plan.md](../plan.md); this file orders them and defines "done". It was hardened by a
> scope, architecture and security panel before it was committed — see the review log at the bottom.

## The goal

Invited households — a friend's family, a coach — use mat-plan on their phones for a few weeks, and
Ray learns whether it is worth widening. A tester can:

1. sign in with Google and land in **their own household**, never seeing anyone else's;
2. add their athletes, who start on a sensible default program;
3. log every day on a phone at the gym;
4. **fix their own mistakes** without asking Ray to run a script;
5. leave, and have their data deleted.

And Ray can sleep: one household's data is unreachable from another — proved by tests, not by
convention — and a bad write can be restored without rolling back everyone else.

It ships in two steps, because the full feature set is months away at ~4h/week and a real family's
feedback is worth more than another month of guessing:

- **Beta 0 — one invited family.** The thinnest slice that is _safe_: isolation, identity, privacy, and
  just enough self-serve to start. **≈ 20–25 PRs.**
- **Beta 1 — 3–5 families, all the major features.** Program editing, schedules, streaks, invites,
  in-place correction. **≈ 20–30 more.**

Everything after that is post-beta (offline, the engine, the MCP, NL logging).

## Decisions

**Made (Ray, 2026-09-30):**

| Decision         | Choice                       | Consequence                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline logging  | **Online-only beta**         | v1.5's PWA/sync phase is the first milestone after beta. On bad wifi a tester may have to retry a save; per-item `client_id` + `ON CONFLICT` makes a retry of the same submit a no-op.                                                                                                               |
| Who signs in     | **Parents and coaches only** | No child accounts. But a kid tapping their tile on a parent's phone **is** a child using the service, so PRIV-1 still needs a real privacy review — see below. For beta, **only a parent creates a household or an athlete**; a coach joins by a parent's invite (Beta 1).                           |
| Sign-in provider | **Google only, via Clerk**   | Clerk was already the spec'd choice; this **pulls it forward from v1.5** (spec, plan and AGENTS.md "Stack" are amended in this PR). Facebook and email links wait for a tester to ask. **Sign-up is invitation-only** — an open Google sign-up on a public repo is an open beta, not an invited one. |

**To decide — before the work that depends on it:**

| Question                                                                                                     | Decide by                                                              | Recommendation                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Household in the URL, or only in the session?** ([HH-1](../plan.md) decided "path", before OAuth was a P0) | An ADR, **first thing in Beta 0** — TEN-1 and AUTH-1 both depend on it | **Session-only for beta**, keep `/p/<profileId>` as the address. Two parents in one household can already share a profile link once authorization comes from the session, and "wrong account" becomes a 404 that TEN-1's proofs cover. HH-1's path segment touches every route, link and `revalidatePath` — the class with two prior incidents. It reverses a decision Ray made, so it is his call. |
| **"Household" or "club"?** (HH-1 raised it)                                                                  | AUTH-1's plan — the first authored write to `households`               | Keep "household" for beta; rename later is a copy change if the schema stays generic.                                                                                                                                                                                                                                                                                                               |
| **Household = a Clerk Organization?**                                                                        | AUTH-1's plan                                                          | Evaluate. Native, email-bound, expiring invitations and memberships would replace a hand-built invite flow, and SECURITY.md already assumes an org-scoped Clerk key for the later MCP token. The cost is vendor coupling on the tenancy model.                                                                                                                                                      |
| How many families, and who?                                                                                  | Before inviting                                                        | One for Beta 0. It shapes whether deletion and invites can stay runbooks.                                                                                                                                                                                                                                                                                                                           |
| Do testers need CSV export?                                                                                  | Beta 1                                                                 | Keep it working (CSV-1) but don't promote it; it is shaped for Ray's Claude workflow.                                                                                                                                                                                                                                                                                                               |

## What "all the major features" means

Confirmed against the backlog. Most of the logging core already ships; the gaps are everything a
stranger needs _around_ it.

| Feature                    | Today                                             | Beta 0                                                                       | Beta 1                                               |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Bodyweight log + correct   | ✅ V1-24 1a/1b                                    | —                                                                            | 1c/1d (duplicate cleanup + index)                    |
| Strength logging           | ✅, with **P0s V1-27, V1-30** open                | both P0s                                                                     | V1-24 3a/3b (correct a set)                          |
| Check-ins, life activities | ✅                                                | —                                                                            | V1-24 2 (correct a check-in)                         |
| Daily routine + editor     | ✅ (`/p/<id>/routine`)                            | —                                                                            | confirm-on-remove, restore default                   |
| History / day paging       | ✅ V1-15                                          | —                                                                            | —                                                    |
| **Delete / clear a day**   | ❌ only `db:correct`, which only Ray can run      | **V1-9b** — the only way a stranger undoes a mis-tap                         | —                                                    |
| **Athletes**               | ❌ created by the seed only                       | **ONB-0** empty state, **PROF-1** create                                     | PROF-1 rename + archive                              |
| **Programs**               | ❌ seed-only (`PROGRAM_SEED`)                     | **ONB-2** — new athletes start on The Daily Five (daily, no schedule needed) | **V1-22** edit, **SCHED-1** which days               |
| **Sign-in + households**   | ❌ one shared access code, existence-only scoping | **TEN-1**, **AUTH-1**                                                        | invites, roles, step-up                              |
| Streaks                    | ❌                                                | —                                                                            | **MOT-1** (needs SCHED-1 so a rest day isn't a miss) |
| CSV export                 | ✅, CSV-1 open                                    | CSV-1                                                                        | —                                                    |

**Out of beta**, unchanged in the backlog: offline (v1.5), the engine and Ray's PPL (v2), the MCP/API
and LLM adapter (v3), NL logging (AI-1), the dashboard and charts (V1-16), DUALS, i18n, Facebook
login, child accounts, kid PINs.

## Beta 0 — one invited family

```mermaid
flowchart LR
  A[0 · now: PII purge, P0s, merge gates] --> AU
  B[1 · ops: previews, seed split, restore] --> AU
  C[ADR: household addressing] --> T[2 · TEN-1 scope seam + proofs]
  T --> AU[3 · AUTH-1: Clerk, invite-only, claim Ray's household]
  AU --> S[4 · ONB-0, PROF-1, ONB-2, V1-9b, PRIV-1]
  S --> I[invite family #1]
```

### 0 · Now, independent

- 🔴 **The public repo must not serve anyone's children's data — every ref, not just `main`.** OSS-1
  rewrote the tournament roster out of `main`, but older refs kept it. **Done 2026-09-30:** the one
  branch still carrying it (`docs/onb-2-daily-five`) was deleted after its draft was rescued (#198);
  a scan of all 30 remaining branches is clean. **Still open:** the read-only PR refs **#152–#167**
  carry it, and only **GitHub Support** can purge PR refs and cached commit views — Ray files that
  request. Then re-scan every ref (branches + `refs/pull/*`) with gitleaks.
- **Open P0s:** V1-30, V1-27, CSV-1 (check prod for kg rows first), DAL-1, SEC-3.
- **SEC-2** (SHA-pin every action, #195) and **the shared redirect helper fix** from #193's review —
  `safeInternalPath` must reject `\`, `%5C`, `//`, absolute and `javascript:` URLs **before** any
  sign-in or invite flow reuses it.
- **DX-5(a)** — required checks, up-to-date branches, no direct pushes. A repo-settings change. (Its CI
  half, DX-5(b), can follow.)

### 1 · Ops fit for other people's data

- **OPS-1 — previews hold neither production data nor production credentials.** Today every preview
  gets the prod `DATABASE_URL` (deploy.md). The fix is **not** a Neon branch of prod — that clones every
  family's bodyweight into every preview. Previews get a database built from the seed only, and the
  Preview environment holds no production secret: a separate Clerk development instance, a separate
  Upstash, no prod Sentry DSN. Verify Vercel's fork-PR protection is on (the repo is public).
- **OPS-2 — split the seed: reference data for prod, fixtures for dev/CI.** `migrate.yml` seeds prod on
  every push, and the seed both writes Ray's family (with public, fixed UUIDs) **and** re-creates them if
  they are ever deleted. But `PROGRAM_SEED` is also how Ray's real program reaches prod, so: split into
  `seedReference` (prod) and `seedFixtures` (dev, CI, e2e, PGlite); keep Ray's program flowing until
  V1-22 replaces it; scope the ramp-target expansion by household (today it writes to every kid in the
  database).
- **OPS-3 — restore one household, rehearsed.** The restore runbook is a TODO stub. A whole-database
  point-in-time restore rolls back every other family's writes and un-deletes deleted ones, so the
  runbook restores **per household** (branch → extract → copy) and re-applies a deletion ledger. One
  drill; delete the drill branch after, since it holds everyone's data.
- **Speed Insights** (ADR 0001 deferred it to prod cutover; it needs the CSP nonce plumbing).

### 2 · TEN-1 — one household cannot see another

Today `listProfiles()` returns every profile in the database and every write is existence-scoped ("any
known profile id writes to that profile"). Accepted with one family; a breach with two.

- **The ADR first** (household addressing, above). TEN-1 and AUTH-1 both build on its answer.
- **TEN-1 — one scoping seam.** A `cache()`d `getHouseholdScope()` in `lib/dal`; **every** DAL read and
  write scopes through it. Before AUTH-1 it resolves to Ray's household; AUTH-1 then swaps only its
  implementation to session → membership, so the sweep happens once. Folds in **DAL-2** (the nine
  hand-written live-profile predicates).
- **The proofs are the point:** `db:verify` drives two households through every read, write, correction
  and export, and asserts B can never see or touch A. Including `findOrCreateMovementId`, which today
  silently **reuses another household's movement row** on a name clash — so B's free-text "RDL" takes
  A's unit and bodyweight flag. Either TEN-1 proves the picker and the metadata stay per household, or
  **TEN-2** (custom movements per household: expand → switch writers → contract, three PRs, partial
  unique indexes built `CONCURRENTLY`) moves into Beta 0.
- TEN-1 alone proves _consistent scoping_. Isolation is only _authorized_ once AUTH-1 lands — the exit
  criteria say both.

### 3 · AUTH-1 — Clerk, Google, invitation-only

- Clerk with **only** the Google strategy enabled and **sign-up restricted to invited emails**. The
  dashboard settings live nowhere in code, so they go in a runbook checklist — along with the
  production instance's own Google OAuth credentials, the consent screen's privacy-policy URL (PRIV-1
  first), and the domain.
- A **`household_members`** table (migration + ERD): a user belongs to a household; the first user is
  its owner.
- **Ray's existing household is claimed, not inherited.** A guarded `db:correct` correction binds it to
  Ray's Clerk user, run **before** the gate goes. No code path may ever treat "the seed household" or
  "the first sign-in" as an owner — its ids are public. A new user gets a new, empty household (a
  TEN-1 proof).
- **The gate is retired; the session replaces it everywhere it was checked.** Every `'use server'`
  export, gated page and Route Handler rejects a caller with no session, enforced by extending the
  existing export-enumeration test so a new action without the check fails CI. `auth()` fails closed;
  the middleware matcher is not relied on (SEC-1's lesson).
- The per-user rate limit: the existing Upstash limiter re-keyed from IP to user id.

### 4 · Just enough self-serve, and privacy

- **ONB-0** — an explained empty state; a new household no longer inherits Ray's routine.
- **PROF-1 (create)** — add an athlete. The first profile-creating endpoint: both panels, the full
  boundary-test set.
- **ONB-2** — new athletes start on [The Daily Five](../programs/daily-five-default.md) (rescued to its
  own PR, #198).
- **V1-9b** — delete a logged item and clear a day.
- **PRIV-1 — privacy, done as a review, not a checkbox.** SECURITY.md defers COPPA only while there is
  "no third-party sharing"; multiple families plus Clerk, Google, Sentry, Vercel, Neon and Upstash is
  that change, so its own trigger fires. Deliverables: a plain-language notice listing what is stored and
  every processor; consent at sign-up; a **written retention policy**; a **defined deletion** — hard
  delete of the household's rows and its Clerk users, with the residuals stated in the notice (the
  point-in-time window, Sentry retention) — run by Ray from a guarded correction for beta; and
  SECURITY.md's threat model rewritten for many households, adults and coaches. ⚠️ Bodily measurements
  of minors may count as health data under some state laws. **This file is not legal advice; get a
  second opinion before inviting anyone.**

### Beta 0 exit criteria — invite family #1 when

- [ ] No ref on the public remote — branches **and** PR refs — contains third-party or child PII,
      verified by a scan over every ref.
- [ ] No open P0. DX-5(a) merge gates are enforced.
- [ ] Previews hold no production data and no production credential; fork protection is on (OPS-1).
- [ ] The prod seed writes reference data only and cannot re-create a deleted household (OPS-2).
- [ ] A single household has been restored from backup without touching any other (OPS-3).
- [ ] `db:verify` proves that a second household cannot read, write, correct or export the first's data —
      every entry point, including the movement catalog (TEN-1).
- [ ] Every action, page and route handler rejects a caller with no session; a profile outside the
      session's household is a 404; per-user data is never cached across users (AUTH-1).
- [ ] An uninvited Google account cannot create a household. Ray's existing household is reachable after
      he signs in, and only by him.
- [ ] On iOS Safari and Android Chrome, with no help: sign in → add an athlete → log a day → delete a
      mis-logged entry.
- [ ] Privacy notice, consent and retention policy are live; household deletion has been run once end to
      end; the privacy review is signed off by a named person (PRIV-1).
- [ ] SEC-3 merged: server-side errors carry no bodyweight to Sentry.

## Beta 1 — 3–5 families, all the major features

Starts after family #1 has used Beta 0 for two weeks **and Ray has read their feedback and decided to
widen.** That check-in is a step, not an afterthought — it is the reason for the beta.

- **Programs:** **V1-22** (edit a program — its plan sizes it at four PRs) and **SCHED-1** (which days
  a program runs; a fixed-weekday first cut is fine).
- **MOT-1** — streaks, on top of SCHED-1 so a rest day is not a broken streak.
- **Athletes:** PROF-1 rename and archive.
- **Household members:** a second parent, and a coach, join by invitation — Clerk Organizations or a
  hand-built link, decided in AUTH-1's plan. A hand-built link needs a ≥128-bit token stored hashed,
  short expiry, single use, revocable, owner-only minting, a confirm screen naming the household, and
  never a token in a logged URL path. **Roles:** owner vs member — who invites, removes, deletes,
  exports.
- **Step-up** (Clerk reverification) before delete-household, invite, member removal and export — on a
  shared phone, the kid holds the parent's session.
- **In-place correction:** V1-24 2 (check-ins), 3a/3b (strength sets), 1c/1d (duplicates).
- **Self-serve household deletion**, behind step-up, replacing the beta-0 runbook.
- **Client-side Sentry** with its own scrubber, Session Replay off, an opaque user id only, a tunnel
  rather than widening `connect-src`.
- **The sensitive-action audit log** SECURITY.md describes: actor, action and resource ids, never values.
- **Support:** runbooks for "I logged the wrong thing", account recovery and member removal; a feedback
  link in the footer; a short tester guide.

### Beta 1 exit criteria

- [ ] Everything in Beta 0, still true.
- [ ] A household can edit its program and choose its days; streaks survive a rest day.
- [ ] A second adult joins by invitation; the invite is single-use and expires; only an owner can invite,
      remove or delete; those actions and export require step-up.
- [ ] Every logged thing can be corrected or deleted in the app.
- [ ] Client errors reach Sentry with no PII; the audit log records sensitive actions without values.
- [ ] Recovery and member-removal runbooks exist and were walked once.

## Risks

- **Scope.** Counted honestly, Beta 0 is ≈ 20–25 PRs and Beta 1 ≈ 20–30 more — most need a plan and a
  panel. At ~4h/week that is several months to Beta 0. If it must shrink, shrink Beta 1, never TEN-1's
  proofs, the PII purge, or PRIV-1.
- **TEN-1 is a sweep.** One missed scope is a cross-family leak, which is why the exit criterion is a
  proof per entry point.
- **Clerk is a new runtime dependency on the auth path,** and its scripts need a reviewed widening of the
  strict CSP. Its outage is the app's outage; acceptable for a beta, recorded in AUTH-1's plan.
- **Ray's household's ids are public** (the seed ids are committed). After AUTH-1 that is harmless —
  only the session authorizes — but it is why no code may ever use them for authorization.

## Review log (panel, 2026-09-30, before commit)

Scope, architecture and security lenses reviewed the first draft. What changed:

| Finding (lens)                                                                                      | Response                                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The PR estimate was ~2× low (scope)                                                                 | **Accepted.** Counted per row; split into Beta 0 and Beta 1 with separate estimates.                                                                  |
| Ray's household would be orphaned, or claimable by a stranger, when the gate goes (scope, security) | **Accepted.** A guarded claim correction before the gate is retired, and an exit criterion.                                                           |
| Open Google sign-up makes it an open beta (scope, security)                                         | **Accepted.** Invitation-only sign-up + exit criterion.                                                                                               |
| Cut V1-22, SCHED-1, MOT-1 and in-place correction from the beta (scope)                             | **Partly.** Out of the _first-family_ gate (Beta 0), but kept as Beta 1's gate: Ray asked for "all the major features" and they are his P0 #5 and #7. |
| Thin vertical slice to the first family (scope)                                                     | **Accepted** — that is Beta 0.                                                                                                                        |
| Runbooks instead of self-serve deletion and invites for a handful of families (scope)               | **Accepted for Beta 0**; self-serve arrives in Beta 1 with step-up.                                                                                   |
| M2 depended on a decision M3 made — a cycle (architecture)                                          | **Accepted.** An ADR on household addressing comes first; moved from "Decisions" to "To decide".                                                      |
| TEN-1 had nothing to get a household from before auth (architecture)                                | **Accepted.** One scoping seam; AUTH-1 swaps its implementation.                                                                                      |
| OPS-2 would cut off Ray's program and re-create a deleted household (architecture)                  | **Accepted.** Seed split into reference vs fixtures; `PROGRAM_SEED` keeps flowing until V1-22.                                                        |
| Catalog scoping mis-described as a hard failure, and under-sized (architecture, scope)              | **Accepted.** It silently shares; TEN-1 proves it or TEN-2 (3 PRs) moves into Beta 0.                                                                 |
| Clerk moving out of v1.5 contradicts spec/plan/AGENTS.md (architecture)                             | **Accepted.** Amended in this PR.                                                                                                                     |
| Rows claimed filed that weren't; new `docs/milestones/` unlisted; two priority lists (architecture) | **Accepted.** Rows filed; AGENTS.md lists `milestones/`; plan.md's priority section points here.                                                      |
| A Neon branch per preview would clone prod data; preview env holds prod secrets (security)          | **Accepted.** OPS-1 rewritten: seed-only preview DB, no prod credentials, fork protection verified.                                                   |
| Isolation proof missed "no session"; path must never authorize (security)                           | **Accepted.** Exit criteria for unauth-reject on every entry point, path-never-authorizes, no cross-user caching.                                     |
| Shared phone: the kid holds the parent's session (security)                                         | **Accepted for Beta 1** (step-up, roles); Beta 0 has no destructive self-serve action for a kid to reach.                                             |
| Invite link had no security properties (security)                                                   | **Accepted.** Properties listed; Clerk Organizations to be evaluated.                                                                                 |
| "Delete" undefined; a restore resurrects deleted data (security)                                    | **Accepted.** Defined deletion with stated residuals; per-household restore with a deletion ledger.                                                   |
| COPPA argument assumed parents are the only users (security)                                        | **Accepted.** PRIV-1 is a signed-off review; only parents create households/athletes in beta.                                                         |
| Open redirect would carry into the sign-in flow (security)                                          | **Accepted.** Fixed in section 0, before AUTH-1.                                                                                                      |
| **Live, outside the doc:** a stale branch and PR refs still carry the minors' roster (security)     | **Verified 2026-09-30.** Branch deleted (draft rescued, #198); PR refs #152–#167 await a GitHub Support purge. Section 0, first item.                 |
| Client Sentry is a gate-quality item, not a beta blocker; DX-5(b) and docs-truth too (scope)        | **Accepted.** Moved to Beta 1 / follow-ups.                                                                                                           |
| ADR 0001 deferred only Speed Insights, not client Sentry; DAL-1 listed twice (architecture)         | **Accepted.** Corrected.                                                                                                                              |
