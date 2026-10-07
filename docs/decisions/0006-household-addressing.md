# ADR 0006 — Household addressing: the URL, or the session?

**Status:** **Proposed — the maintainer's call, unsigned.** · **Date:** 2026-10-07 ·
**Scope:** Beta 0's critical path ([TEN-1](../plan.md), [AUTH-1](../plan.md)) ·
**Supersedes, if accepted:** [HH-1](../plan.md#hh-1)'s path clause — **only** that clause.

> **This reverses a decision the maintainer already made.** HH-1 (2026-09-28) put the household id in
> the **path**, decided before OAuth was a P0 and before the repo was public. So this is written to be
> _decided_: the options carry their real costs, every count was measured and is reproducible, and the
> decision box at the bottom is empty.
>
> **Two kinds of content, and only one of them is unsigned** (the architecture lens forced this split,
> **A2**). Because a document that quietly pre-applies its conclusions is pre-decided in fact:
>
> | Decided **now**, because it holds under every option                                 | Landed in this PR                                                                                     |
> | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
> | **A URL segment is an input, never a credential** (the section below)                | —                                                                                                     |
> | **404, never 403, on a human-facing surface** — a wrong segment is "exactly as loud" | `.github/SECURITY.md`'s 403 narrowed to a rule; two wrong cells of `plan.md`'s comparison table fixed |
> | **The one unsigned choice: option A or option B.** Nothing else in here waits on it. | Four _proposed_ pointers: `plan.md`, `beta-1.md`, `roadmap.md`, `status.md`                           |
>
> **Choosing option B means un-writing those four pointers** — a cost option B states rather than
> hides. The two landed edits stand either way, which is why they landed.
>
> **Citation policy.** Code and documents this PR does not edit are cited `path:line`. Documents this
> PR _does_ edit (`plan.md`, `beta-1.md`, `SECURITY.md`, `roadmap.md`, `status.md`) are cited by
> **section**, because the first draft of this ADR cited them by line and its own edits moved every one
> of those lines — found by the correctness lens, logged below as **C2**.

## Context

**Nothing in the app addresses a household.** The route surface is `/`, `/gate`, `/p`,
`/p/<profileId>`, `/p/<profileId>/routine` and the handler `/p/<profileId>/export` — six routable
paths across five `page.tsx` files and one `route.ts` (plus `app/layout.tsx`, `app/error.tsx` and
`app/p/loading.tsx`, which are not addressable). The data model has been multi-tenant since V1-1a:
`households` carries its own UUIDv7 `public_id` (`packages/db/src/schema.ts:122`) and
`profiles.household_id` is the authz root (`:134-137`). No URL, link or redirect has ever carried a
household.

**Nor does anything authorize by one.** `listProfiles()`'s only predicate is
`isNull(profiles.deletedAt)` (`apps/web/lib/dal/profiles.ts:33`) — every profile in the database.
Every write is existence-scoped, which the source says in as many words
(`apps/web/app/p/[profileId]/actions.ts:162-165`). That is
[`.github/SECURITY.md:6`](../../.github/SECURITY.md)'s **#1 risk** against `:12`'s rule that _"every
query is scoped by `household_id`"_ — a rule the code has never satisfied.

**Three things changed after HH-1.**

1. **AUTH-1 became a P0** on a security rationale rather than a convenience one: the gate is one
   shared password and the repo is public, so there is no per-person revocation
   ([plan.md](../plan.md) → AUTH-1).
2. **The milestone ordered the work `ADR → TEN-1 → AUTH-1`** ([beta-1.md](../milestones/beta-1.md) §
   "Beta 0" flowchart and § 2), because TEN-1 had nothing to get a household _from_ before auth and
   AUTH-1 swaps only the resolver's body.
3. **TEN-1's plan is written and blocked on this.** Its open question Q1 is literally _"ADR 0006:
   session-only, `/p/<profileId>` stays?"_, marked 🔴 blocking, and every error shape in it assumes an
   answer (`docs/plans/ten-1-household-scope.md` → Open questions, **Q1**). The plan makes this ADR its **chunk 0**.

## The question, un-conflated

HH-1, `plan.md` and `beta-1.md` each treat "household in the URL" as one question. It is three, and
only one is a security question:

| #     | Question                                                       | Kind                |
| ----- | -------------------------------------------------------------- | ------------------- |
| **1** | Does a household id appear in the **address** of a page?       | UX / addressability |
| **2** | Where does the household come from when a query is **scoped**? | **security**        |
| **3** | What does a **wrong-household** request return?                | security + UX       |

Question 2 has the same answer under every option, which is what collapses most of the argument.

## Why the options are closer than they look

**A URL segment is an input, never a credential.** This holds whichever option is chosen, and it is
the single most load-bearing sentence in this document.

A household id in the path is untrusted input, exactly as `profileId` is today. The export handler
states the rule for the id it already carries: _"Re-validate the URL-supplied public id server-side —
the V1-3 ownership seam. Profile tiles are a UX switch, not a security boundary, so the id is
untrusted input here"_ (`apps/web/app/p/[profileId]/export/route.ts:44-45`).
`docs/features/write-path.md:68-70` makes it an invariant; AGENTS.md → Server conventions says it for
every entry point. The nearest thing to in-repo support for the general rule is
[beta-1.md](../milestones/beta-1.md) § Risks, on the maintainer's own public seed ids: _"it is why **no
code may ever use them for authorization**."_

Therefore **a path-addressed app must still resolve the household from the session and compare.** The
path buys no authorization step. It _adds_ one: two ids that must agree, and a new failure mode — a
valid profile under the **wrong** household, which looks authorized to any check that validates only
the profile id. HH-1 named that hole itself ([plan.md](../plan.md) → HH-1 → "What it touches", point
3).

So **"path as the address, session as the authorization" — the combination HH-1 actually described —
is not a third option. It is the path option.** Its cost is the sweep, not the authorization model.

## The blast radius, measured

Counted on `origin/main` at `0e0ff5b`. The distinction the first draft missed, and the reuse lens
forced (**R3**), is between **definitions that would change** and **files that merely mention the
address** — the repo's constants rule has already absorbed part of the sweep, which is a point _for_
that rule and makes option B cheaper than a raw file count implies.

**Definitions and call sites that would change:**

| Thing                                             | Count                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revalidatePath` call sites                       | **12**, all in `apps/web/app/p/[profileId]/actions.ts` — 11 `` `/p/${profile.id}` `` and one `` `/p/${profile.id}/routine` `` at `:626`                                                                                         |
| …and the assertions pinning them                  | **12** in `actions.test.ts` (the 7 `not.toHaveBeenCalled` assertions are correctly not counted)                                                                                                                                 |
| Profile-addressed `href` sites                    | **5** — `day-nav.tsx:34` (one builder feeding two attributes), `p/[profileId]/page.tsx:163` and `:360`, `routine/page.tsx:35`, `components/profiles/profile-tile.tsx:19`                                                        |
| `APP_HOME_PATH` consumers whose behaviour changes | **5** — `proxy.ts:81`, `app/gate/actions.ts:88`, `p/[profileId]/page.tsx:133`, and the **default route of the screenshot tooling** (`scripts/screenshot.ts:25`, `scripts/screenshot-ephemeral.ts:928`, both `?? APP_HOME_PATH`) |
| Redirects that resolve **home**                   | **2** — `proxy.ts:81`, `gate/actions.ts:88`. (The other two redirect sites resolve the **gate** through `GATE_PATH`, which option B does not touch.)                                                                            |
| Addressable route files under the prefix          | **4** page files + the export handler                                                                                                                                                                                           |
| e2e route constants                               | **2** definitions (`e2e/steps.ts:24,32`) feeding **11** spec/script files — centralisation already absorbed this                                                                                                                |
| `APP_HOME_PATH` in e2e / tests                    | **20** e2e references plus the `proxy.test.ts` / `gate/actions.test.ts` / `constants.test.ts` assertions                                                                                                                        |
| **Files that merely mention the address**         | **31** `.ts`/`.tsx` files across `apps/` and `packages/`                                                                                                                                                                        |

```bash
# reproducible at 0e0ff5b
grep -rn 'revalidatePath(' --include='*.ts' apps packages | grep -v '\.test\.' | wc -l          # 12
grep -rn 'APP_HOME_PATH' --include='*.ts' --include='*.tsx' apps packages | grep -v '\.test\.'  # incl. e2e
grep -rl "/p/\|APP_HOME_PATH\|'/p'" --include='*.ts' --include='*.tsx' apps packages | wc -l    # 31
```

**One item is a deletion, not an edit, and it costs two behaviours.** The proxy's rule is

```ts
if (authed && (pathname === GATE_PATH || pathname === '/')) {   // apps/web/proxy.ts:79
```

— so it is the **landing → home** hop _and_ the **post-login gate → home** hop, each pinned by a test
(`apps/web/proxy.test.ts:36-44`). Under path addressing home is `/<household-id>`, and the proxy has
env and a cookie — no DB, no session. It cannot be adapted. The constant's own docblock already
records the consequence, written for this decision:

> ⚠️ Branch-specific under HH-1… The next author must then **DELETE** the proxy's `/` → home rule and
> resolve home in a page that can check membership — not teach the proxy, which is the
> proxy-as-authorization mistake (CVE-2025-29927). — `apps/web/lib/constants.ts:36-39`

### The incident class, with its guards credited

The first draft argued a new path shape re-opens _"the class with two prior incidents"_ — the framing
[beta-1.md](../milestones/beta-1.md) used to carry and `docs/plans/ten-1-household-scope.md` → "Out-of-scope / deferred"
still does. Both incidents are real:

1. **#153 — a new path shape drifted from the gate's public-path set and `/duals` bounced every
   visitor to `/gate`.** Cited in-repo at `apps/web/app/pages-are-gated.test.ts:13` (_"DUALS-1's merge
   accident (#153) was exactly that kind of silent loss"_). The fixing PR is titled
   `fix(duals-1): make the duals routes public, as DUALS-1 intended`.
2. **The matcher's `/api` exclusion, which would have shipped the CSV export completely ungated.**
   `docs/tech-debt.md:66-83`: V1-13b's export was about to be `/api/export`; it ships at
   `/p/[profileId]/export` instead — _"inside the matcher"_ — the reason `export/route.ts:16-21`
   records for its odd siting. **The `/api` half is still open** (`tech-debt.md:96-97`).

**But the class is now largely guarded, and the first draft failed to say so (reuse lens, R1).**
`apps/web/app/pages-are-gated.test.ts:41-65` globs **every** `page.tsx` and `route.ts` and asserts each
either `await requireGatedPage()` or `isUngatedPath(route)`, with comments stripped so a `// TODO`
cannot satisfy it; `apps/web/proxy.test.ts:93-114` compiles `config.matcher` with Next's own compiler
and pins the anchoring. **Probed, not assumed:** a throwaway `app/zz-probe/page.tsx` with no
`requireGatedPage()` call fails that spec by name (1 failed / 915 passed), and was deleted.

So the honest residual is narrower than "a third path shape is a third chance":

- a route **deliberately** added to `PUBLIC_PATHS` — which is #153's actual shape, and a visible test
  edit by design (`apps/web/lib/access-gate.ts`, `PUBLIC_PATHS`);
- the **matcher-level** `/api` hole, which `pages-are-gated` does not cover because it tests pages,
  not the matcher, and which is still open;
- and one thing specific to HH-1's own sketch (`/<household-id>` at the top level): a top-level
  dynamic segment makes the household namespace and the route namespace **the same namespace**, so
  every future top-level route is a reserved word. A prefixed form (`/h/<id>/…`) avoids it entirely,
  and is the cheaper shape if option B is chosen.

**The shape of the risk still differs from its size.** One missed `revalidatePath` shows an athlete
stale data; one missed public-path rule is a gate incident. The sweep is mechanical and guarded; the
gate change is neither.

## Options

### Option A — session-only; `/p/<profileId>` stays the address · **recommended**

The household comes from the session, through TEN-1's single `getHouseholdScope()` seam. No URL, link,
redirect or `revalidatePath` changes.

`getProfileByPublicId` is the resolve point at **11 call sites** covering every profile-addressed
entry point (7 Server Actions at `actions.ts:105,219,348,444,485,545,618`; `p/[profileId]/page.tsx:57`;
`routine/page.tsx:28`; `export/route.ts:46`; `lib/dal/export.ts:120`), so scoping that one function
fails them all closed at one gate. TEN-1's plan says **"8 of the 9 entry points"** resolve through it
(`ten-1-household-scope.md` → "Entry points") — and the ninth matters more than the eight.

**What it costs.**

1. **The picker is the one entry point with no second factor, and option A makes `listProfiles` the
   entire boundary.** `apps/web/app/p/page.tsx:18` → `listProfiles()`, whose only predicate is
   `isNull(deletedAt)` (`lib/dal/profiles.ts:33`). Under A the picker's URL is `/p` for every household
   on earth, so there is no id in the address to disagree with the session. TEN-1's plan already calls
   it _"the single most important site in TEN-1"_ (`ten-1-household-scope.md` → "The nine"). **Named
   obligation of this decision:** the picker returns only the session household's profiles, proved by a
   `db:verify` case with two households and two profiles each. (Raised by the security lens, **S1**.)
2. **Every caching layer becomes the cross-household channel.** Under A, `/p` and `/p/<id>` are
   byte-identical URLs for every household, so **nothing in any cache key distinguishes tenants.** The
   only thing between that and a leak is `export const dynamic = 'force-dynamic'`
   (`apps/web/app/layout.tsx:25`) — whose own comment justifies it by the **CSP nonce** (`:21-24`), not
   by tenancy, and which **no test pins** (`grep -rn force-dynamic apps packages` finds that line and
   four comments). Add `unstable_cache` / `'use cache'` to a household-scoped read, or a CDN rule on
   `/p`, and household A's athletes are served to household B. Under B the path key contains the
   mistake. **Named obligations:** a test pinning the directive with a comment saying tenancy now
   depends on it, and the rule that no household-scoped read enters a cache without the household id in
   the key — which `beta-1.md`'s AUTH-1 exit criterion (_"per-user data is never cached across
   users"_) already demands. `revalidatePath` is **not** affected: profile public ids are globally
   unique, so the 12 call sites cannot collide across households — non-obvious, and the reason the
   sweep argument holds. (Security lens, **S4**.)
3. **This is the one cost that grows with the app.** Option B's one-way door (the proxy deletion) is
   paid once; A's obligation to make every future caching decision tenant-safe without a path key to
   help is permanent. (Security lens, **S8**.)
4. **The addressability residual** — see "[the shared-link question](#the-shared-link-question)".

**What it buys.** TEN-1 ships as a DAL-only change with no route surface, so the authorization sweep is
reviewable on its own; AUTH-1 then swaps one function body. Nothing in the gate's reachability model
moves during the one milestone whose whole point is isolation.

### Option B — a household path segment now (HH-1 as decided)

`/<household-public-id>/p/<profileId>`, HH-1's own sketch. The session still authorizes, and the
segment must additionally be verified against it.

**What it costs.** The measured sweep above; the proxy deletion with its two hops and two tests;
`APP_HOME_PATH` ceasing to be a constant, including the screenshot tooling's default route (the
mandated UI-PR procedure); a second id to agree on at every entry point — and therefore **a boundary
test per entry point, not one**, because TEN-1's acceptance already requires a per-entry-point proof
(security lens, **S-also**); ONB-0's empty state moving to an unwritten screen; the top-level-namespace
collision above unless the prefixed form is used; and **un-writing the four pointers this PR already
wrote**.

It also lands during the milestone whose exit criteria are about isolation, next to the subsystem with
two prior incidents — narrowed, but not eliminated, by the guards credited above.

**What it buys.** A URL that names whose data it is, and addressability for a user in more than one
household — **of which beta has, by construction, no instance**: sign-up is invitation-only, AUTH-1
ships `household_members` with exactly one member, and a second parent or coach joining is Beta 1
([beta-1.md](../milestones/beta-1.md) § "Beta 1", and its exit criterion that the maintainer's
household is reachable _"and only by him"_).

A cookie- or query-param-selected "active household" is option B with a weaker address and the same
sweep: two tabs disagree, a shared link resolves differently per viewer, and `revalidatePath` cannot
key on it. Not treated as a separate option.

## Recommendation

**Option A — session-only for beta, `/p/<profileId>` unchanged.** Three reasons:

1. **The path buys no security and costs the subsystem with scars.** The rule above settles the first
   half; the measured sweep and the two sourced incidents the second.
2. **Beta has no user the path serves.** Invitation-only, one member at AUTH-1, coaches in Beta 1.
3. **It is reversible at a known and only slightly rising price.** The scope lens was right that the
   first draft's _"the price does not rise"_ was refuted by this document's own foreclosure section
   (**P1**). Honestly: a later move costs the same mechanical sweep against a larger tree, **plus** one
   permanent-redirect route, **plus** a second path shape in the scarred subsystem. Still small,
   because the sweep is mechanical and the guards above cover the shape — but not free.

Against: it reverses a made decision, and the maintainer's reasons for HH-1 came from _using_ the app,
which is a kind of evidence this document cannot produce. If the addressability case reads as more
important than it measures, option B is defensible — just not in the same PR as TEN-1.

### The shared-link question

`plan.md`'s comparison table recorded session-scoping as **❌** for _"shareable link between two
parents"_ (_"each sees their own"_). **Wrong for the case it is about.** Once authorization comes from
session → membership → household, two parents of **one** household both resolve to that household, so
`/p/<kidPublicId>` opens the same athlete for both. The resolution direction is identical whether
`household_members` is hand-built or a Clerk Organization.

**Scoped honestly (correctness lens, C6):** that is true of the _design_, not of beta. AUTH-1 ships
the table with one member and the second parent is Beta 1, so there is no one to share with yet — and
this ADR explicitly does not settle `household_members`. What session-only cannot express is **which
household a link means for a user who belongs to more than one**, and beta has no such user.

That table row is corrected in this PR. It is listed here, in Context, rather than under Consequences,
because it has already landed.

### What fails loudly, and what does not

`plan.md`'s second row said session-scoping makes _"wrong-account-wrong-kids"_ fail **silently**. Much
narrower than that:

- **A shared or bookmarked deep link still fails loudly.** Signed into the wrong account,
  `/p/<kidPublicId>` is not in that session's household, so it is a 404 — `page.tsx:57-58` and
  `routine/page.tsx:28-29` both `notFound()` on a null profile, `export/route.ts:46-47` returns 404.
  Exactly as loud as a wrong household segment.
- **The bare home URL is the residual.** `/` → `/p` has no id to disagree with the session, so the
  wrong account lands on its own picker. Nothing on screen is wrong; it is just the other family.
  ⚠️ **That sentence is only true once `listProfiles` is scoped** — cost 1 above.
- **The fix is UI, not a URL.** If a second account ever confuses a tester, naming the household on the
  picker is a copy change in the `PICKER_COPY` idiom (interpolated copy in that file is a **function
  member**, e.g. `AMEND_ERROR_COPY.notFound`, not a static string) plus the household name on the
  **picker's read DTO** — never on `HouseholdScope`, which exists to make a request-supplied id a type
  error. `households.name` already has one home (`schema.ts:123`). Noted against AUTH-1; not filed as
  its own row (scope lens, **P4**).

## What a wrong-household request returns: **404**

**Decision: 404 on every human-facing surface** — page, Route Handler, and for a Server Action the
existing typed envelope, which is indistinguishable from an unknown id.
[beta-1.md](../milestones/beta-1.md)'s AUTH-1 exit criterion already says it; this is the reasoning,
because the repo contains both answers.

**Why not 403 — rebuilt, because the first draft's premise was inverted.** Both the correctness and
security lenses killed the original argument (_"UUIDv7 ids are non-enumerable, and the committed seed
ids make the leaked bit non-hypothetical"_). It is backwards: a committed id is one whose existence is
_already public_, so for exactly those ids 403 and 404 leak identically. The argument that survives is
the repo's own, and it is about **one answer for three states**:

- `export/route.ts:40` — _"404, not 401: an un-authed caller learns nothing about whether this profile
  exists."_
- `AMEND_ERROR_COPY.notFound`'s docblock (`apps/web/lib/constants.ts:328-329`) — _"The row is gone, was
  never theirs, or is not amendable. ONE message for all three **on purpose**: a crafted
  cross-profile id must learn nothing a stale id wouldn't."_
- `actions.ts:73-76` — `NO_PROFILE_LOG` / `NO_PROFILE_SAVE`, whose comment is the same argument a third
  time: _"An un-gated caller gets exactly this too (SEC-1), so it learns nothing about whether the gate
  or the profile turned it away."_ All seven actions return it. **This is the envelope TEN-1 extends**
  (reuse lens, **R4**) — and both constants are module-local to `actions.ts`, so **TEN-1 promotes them
  to `apps/web/lib/constants.ts`** rather than re-typing the copy at a new surface.

The threat that makes 403 wrong is therefore not enumeration but a **leak**: an id an attacker holds
came from a shared link, a screenshot or a log line, and 403 confirms the leak is live. 404 refuses to.

### What the server records — because the query shape is decided here

**Decided here, not deferred, because this ADR fixes the shape that makes it impossible.** A single
scoped predicate (`public_id ∧ deleted_at IS NULL ∧ household_id = scope`) returns "no row" for both
"unknown id" and "exists elsewhere", so the server **cannot tell them apart** — and the #1 risk in the
threat model becomes the one event that produces no signal: no Sentry, no audit row, nothing to rate
limit on. `.github/SECURITY.md` → Logging requires sensitive/mutating actions be audited, and
[beta-1.md](../milestones/beta-1.md) makes the audit log a Beta-1 exit criterion.

**So: on a scope miss only, re-resolve the public id without the household conjunct and emit one
structured event** — actor, action, `resource = publicId`, `outcome = cross_household` — and **no name,
no bodyweight, no `params:`** (SEC-3: drizzle's `DrizzleQueryError` embeds query params in its message,
and that already shipped a kid's bodyweight to Sentry once). Externally still 404. The extra query is
on the miss path only, so the happy path pays nothing, and it is what makes rate-limiting id probing
possible at all. (Security lens, **S2** — the finding this ADR would otherwise have ratified in two
documents at once.)

### The `/v1` carve-out, scoped as a rule rather than a surface

`.github/SECURITY.md` specified _"403 on wrong household"_ under `## API shape`, which read as a
contradiction. The first draft scoped it to `/v1` on the grounds that a machine caller already knows
what exists. **The security lens refuted that** (**S6**): a least-privilege household-scoped token by
construction knows nothing about ids outside its household, so a 403 there is the same oracle — on the
one surface whose output reaches an LLM.

**So the rule, not the surface, is scoped: 403 only for an id inside the caller's own household that
its scope does not permit; 404 for everything else.** RFC 9457 wants a precise status, and that is the
only case where precision leaks nothing. **Edited in this PR**, not deferred — this change is what
creates the apparent conflict (scope lens **P7**, security lens **S6**).

## Where authorization comes from

**The session, through TEN-1's single seam. No URL segment authorizes anything, ever.** Not new
policy: `.github/SECURITY.md:15-16` (_"Middleware is NOT the auth boundary (CVE-2025-29927)"_), the
gate's own scar (`apps/web/lib/access-gate.ts:4`: _"a DELIBERATE STOPGAP, not an authorization
boundary"_), and `docs/features/write-path.md:68-74`, whose invariant 3 makes it checkable: _"A guard
that exists only in the DAL is a guard no proof covers."_

⚠️ **In the present tense, none of that machinery exists, and this document must not be read as
claiming it does.** There is no session (one shared password) and no `household_members` table
(`grep -rn household_members packages apps` → nothing). Between TEN-1 and AUTH-1,
`getHouseholdScope()` resolves to **the one live household** — a singleton, not a session resolution —
and returns `null`, leaving the app dark rather than leaky, on zero or ≥2 households. **So TEN-1 buys
_consistent scoping_; isolation is only _authorized_ at AUTH-1**, which TEN-1's plan calls _"the most
likely thing for a reader to over-claim."_ That is also a sequencing constraint: a second household
cannot exist in prod before AUTH-1 without the app going dark. (Security lens, **S5**.)

The request→authorization flow under option A is diagrammed **in this PR's description**, not here:
ADR 0005's panel ruled that an ADR carries no diagram and the Mermaid belongs in the implementing PR
and `docs/architecture.md` (`0005-programming-model.md:362`), which AGENTS.md → "Diagrams in the PR
description" also says (scope lens, **P3**).

**And the committed diagram already exists**: `docs/architecture.md` **§2b — "Profile routing —
landing → picker → scoped Today"** (`:95-126`) is the home for this exact flow, and the first draft
neither cited nor reconciled it (architecture lens, **A-also**). It is accurate today and becomes
wrong the moment the scope lands, because its `getProfileByPublicId(id) → notFound() if null` node
gains a household conjunct and its picker node stops meaning "every profile". **TEN-1 owns that edit**
(its chunk 1d); the PR description's diagram is drawn to agree with §2b so the two cannot diverge.

Two corrections the architecture lens made to the first draft's diagram, kept here because they are
facts about the flow rather than about the picture: the un-authed branch is **a redirect to `/gate`
for a page** (`apps/web/lib/dal/gate.ts:27`, `proxy.ts:66-72`) and **404 only for a Route Handler**
(`export/route.ts:40`) — not one shape; and the resolve point for `GET /p/<profileId>` is
`getProfileByPublicId` in `apps/web/lib/dal/profiles.ts`, which _calls_ `isLiveProfile` — a predicate
defined in **`packages/db/src/writers/ownership.ts:32`, outside `lib/dal`**. That package crossing is
the most consequential architectural fact about option A: it is why TEN-1 treats the signature change
as breaking.

One clause so the single gate is not over-sold: the export route resolves the profile **twice**
(`export/route.ts:46`, then `buildExportZip` re-querying by public id at `:49`), and `db:correct`'s
registry query (`ten-1-household-scope.md` → "Entry points") sits outside the gate entirely. "Fails closed at one
gate" is the shape; TEN-1 still has to convert all nine depth predicates.

## Does this foreclose anything?

**No, and the forward path is named rather than assumed.**

**Multi-household per user — costed, contained, not foreclosed.** TEN-1's resolver takes no argument,
which answers _"the one household."_ A user in two households needs _"the household that authorizes
**this** profile"_, which **inverts the direction of resolution**: resolve the candidate household from
the addressed profile, then assert membership. TEN-1's plan (**Q5**) costs that inversion as
`getHouseholdScope(profilePublicId)`, _"confined to one file plus the ~11 call sites inside `lib/dal`"_,
because pages and actions never hold the scope. **That containment is what makes option A safe to defer
into, and the reason not to thread a scope through page signatures today.** This ADR is the owner of
that forward path — TEN-1's Q5 asked for it to be recorded here, so Q5 now links rather than restates
(architecture lens, **A8**).

**COACH-1 is a different shape, and the first draft wrongly folded it into the above (architecture
lens, A5).** COACH-1 is explicitly **not** membership — [plan.md](../plan.md) → COACH-1: _"a coach sees
athletes across households, **by permission**… a scope seam that can express **'not mine, but shared
with me'**."_ A seam returning a tenant id, consumed by `household_id = scope.householdId`, cannot
express a grant: it needs the seam's **return type** to widen from a tenant to an authorization
relation (viewer × profile → permission). That is a different shape, not an inverted argument, so
"costed above" does **not** cover it.

**What this ADR therefore asks of TEN-1, and does not decide:** `HouseholdScope` must not become a
naked `household_id`. TEN-1's design already has it right — a branded object
(`{ householdId, synthetic, brand }`), whose only constructors are the request-derived resolver and a
script-named one — and a branded record is extensible to a relation in a way a bare number is not.
COACH-1 carries a 🔴 consent flag and the `privacy-reviewer` lens on every PR; its seam shape is its
own decision, and `lib/dal/` household scoping is a [roadmap.md](../roadmap.md) **seam owned by
Tenancy**, which consumers do not redefine.

**Adding a segment later** costs the mechanical sweep against a larger tree, plus two new things
(reason 3 above): a permanent redirect from `/p/<profileId>` to `/<household>/p/<profileId>`, resolving
the household from the profile in a page or handler and **never the proxy** (`constants.ts:36-39`); and
a second path shape, which gets the public/gated set checked by the guards credited above rather than
by memory.

**Where it lands when it does: household-grain surfaces only.** A segment for pages whose _subject_ is
the household — a program library, a future `/<household>/members` — leaving `/p/<profileId>/…` alone.
That is the smallest honest version of option B and the shape A upgrades into. It is not adopted today
because no such surface exists.

**What option B would foreclose, for symmetry:** `APP_HOME_PATH` stops being a constant and the proxy's
two home hops are deleted outright, not ported — a one-way door inside the gate subsystem, taken
during the isolation milestone.

## What this settles for ADR 0005

ADR 0005 deferred **four** routes here by name — `/home`, `/workouts`, `/movements`, `/calendar`
(`0005-programming-model.md:274-279`) — for **two** reasons: a top-level `/workouts/<id>` _"has no
profile to scope by **and, before TEN-1, no household scope either**."_ Its open question 1 is
separately **✅ decided**: `/p/<id>/program`, with the household library waiting for TEN-1 (`:317-325`).

**The first draft answered the wrong question** (architecture lens, **A4**): it said a household-grain
surface takes a segment "only once one exists", which answers _whether a segment is added_. ADR 0005
asked _whether a household-grain route is permitted at all_ — and option A's whole deliverable,
`getHouseholdScope()`, **removes 0005's second reason**. So, stated properly:

- **Under option A a household-grain surface is _permitted_ at a top-level path with no segment**,
  because the session supplies the scope. It becomes newly defensible, not newly forbidden. The
  segment question only arises under option B or the household-grain-only shape.
- **`/p/<id>/program` still stands** — 0005's open question 1 is decided on the profile-id reason,
  which option A does not touch, and this ADR does not re-open it.
- **`/movements` becomes household-grain the moment TEN-2 adds `movements.household_id`** — so its
  route belongs to **TEN-2**, not here, and TEN-2 is not re-decided (below).
- **`/calendar` belongs to SCHED-1's own ADR**, named rather than silently punted.
- **`/home` is already answered**: OSS-2 shipped `/` as the public landing and `/p` as `APP_HOME_PATH`.

Assigning each of the four is the point — otherwise V1-22's library and the movement catalog get
re-litigated by the next author.

## Relationship to TEN-2 — none, and TEN-2 is not re-decided here

`findOrCreateMovementId` reuses another household's `movements` row on a slug clash, so B's free-text
"RDL" takes A's unit and bodyweight flag. **Addressing changes nothing:** the cause is schema —
`movements` has no `household_id` column at all (`apps/web/lib/dal/catalog.ts:76-90`;
`packages/db/src/schema.ts:417-438`), which is why TEN-1's plan calls it _"unscopable"_
(`ten-1-household-scope.md` → "Entry points"). A URL segment could not scope a writer that never reads a URL, and
under the rule above it must not. TEN-2's Beta-0 go/no-go stays where the milestone and TEN-1's
acceptance put it: decided by TEN-1's proof.

## What this does not settle

- **`household_members`, roles, invites, Clerk Organizations** — AUTH-1's plan.
- **"Household" or "club"** — AUTH-1's plan. HH-1's club argument is **untouched** and survives in
  full: a tenant that can be a club still affects the table's name, the membership-role axis, and
  PROF-1.
- **Separation _inside_ a household.** Under option A the only tenancy signal is the cookie, and the
  within-household signal is a profile id the repo declares non-security (`apps/web/app/p/page.tsx:13`:
  _"Profile tiles are a UX switch, not a security boundary"_). On a shared phone — the stated
  deployment — anyone holding the session reaches every athlete's page, bodyweight included.
  `profiles.pin_hash` is reserved for this and nothing reads it (`schema.ts:140`). **Identical under
  option B**, so not an argument either way — recorded so "a profile outside the session's household is
  a 404" is never read as privacy _within_ the household. Belongs to PROF-1 / Beta 1 step-up. (Security
  lens, **S7**.)
- **Postgres RLS** — TEN-1 rejected it for beta with reasons and named it the post-beta hardening
  option that _composes_ with a single scope point (`ten-1-household-scope.md` → Alternatives, item 1). Unchanged.
- **Per-household rate limiting, `/api/sync`, the MCP token** — no `/v1` surface exists.
- **Scheduling** — SCHED-1's own ADR.

## Consequences

**If option A is accepted:**

- TEN-1 is unblocked and ships as a DAL-only change: no route, link, `revalidatePath` or proxy edit.
  Its Q1 closes; its Q5 forward path is recorded above.
- TEN-1 gains three **named obligations** this ADR creates: the picker scoped and proved with two
  households; the `force-dynamic` / no-cache-without-household-key rule pinned by a test; and the
  cross-household structured event on the miss path.
- TEN-1 promotes `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` to `apps/web/lib/constants.ts` instead of
  re-typing the copy at new surfaces.
- HH-1 is **narrowed, not retired** — its URL clause superseded, its club question and its matcher and
  two-ids warnings live. That is decided here rather than asked, per the scope lens (**P8**).
- `.github/SECURITY.md`'s 403 is scoped to a **rule** in this PR, so no live contradiction is left in
  the authoritative security doc.
- 🔴 **One new backlog row, and it is live today regardless of which option is signed.** The seed
  `public_id`s have **zero entropy** — `019826b4-0000-7000-8000-00000000000{1,2}` and `…0010`
  (`packages/shared/src/seed-ids.ts:10-15`), upserted into prod by `packages/db/src/seed.ts` — so
  `…0003` is a _guess_, not an enumeration. And `apps/web/lib/rate-limit.ts:14-16` justifies **not**
  rate-limiting the six mutating Server Actions on exactly the premise those ids falsify: _"real ids are
  non-enumerable UUIDv7 (SECURITY.md's anti-IDOR design) and therefore unreachable by guess."_ Rotate
  the seed ids to real UUIDv7 (or stop seeding identities into prod) before the first beta invite, and
  re-examine that comment. **Found by the security lens (S3) while attacking this ADR's original
  premise** — the premise is gone from the ADR, but the live gap it pointed at is not.

**If option B is accepted instead:** TEN-1 gains the measured sweep, a boundary test per entry point,
the proxy's two home hops deleted and home resolution moved into a membership-checking page, the
screenshot tooling's default route rebuilt, ONB-0 moved, and the four pointers this PR wrote un-written.
The sweep should then be **its own PR, after TEN-1**, so the authorization change stays reviewable
apart from a mechanical diff — the argument TEN-1's own alternative 7 makes
(`ten-1-household-scope.md` → Alternatives, item 7). Decided here rather than asked (scope lens, **P8**).

## Backlog impact

| Row                  | Impact                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **HH-1**             | URL clause **superseded** under A; club question and matcher / ownership warnings survive intact.                                                                        |
| **TEN-1**            | **Unblocked**, plus the three named obligations above. Q1 answered; Q5's forward path recorded.                                                                          |
| **AUTH-1**           | Swaps `getHouseholdScope()`'s body only. The 404 rule, the segment-is-not-a-credential rule and the cross-household event are its boundary-test contract.                |
| **TEN-2**            | **Unaffected** — schema, not addressing.                                                                                                                                 |
| **DAL-2**            | Unaffected; the same edit as TEN-1's predicate conversion.                                                                                                               |
| **V1-22 / ADR 0005** | Program authoring stays at `/p/<profileId>/program`; the household library stays deferred. 0005's route table is answered by the rule above, not re-opened.              |
| **ONB-0**            | Empty state stays at `/p` under A; moves under B.                                                                                                                        |
| **PROF-1**           | HH-1 sequenced it after the URL decision. Under A that dependency **dissolves** — no new path to author into — so PROF-1 is gated only by TEN-1. Owns `pin_hash`.        |
| **COACH-1**          | Needs the resolution-direction inversion, costed above and not foreclosed.                                                                                               |
| **OSS-2**            | Its `/` landing and `APP_HOME_PATH` survive unchanged under A; under B the proxy rule is deleted, as its own plan's A3 finding recorded (`oss-2-public-landing.md:637`). |
| **NEW (seed ids)**   | Rotate the zero-entropy seed `public_id`s and re-examine `rate-limit.ts`'s justification. P1, live today.                                                                |

## Open questions — for the maintainer

The first draft asked five. Four were author decisions dressed as homework, and the scope lens
(**P8**) was right to say so: HH-1 is **narrowed**, the `SECURITY.md` clause is edited **now**, option
B's sweep would get **its own PR**, and the picker-naming row is **not filed**. All four are decided in
the text above. Two remain:

1. 🔴 **The decision itself: option A or option B?** Unsigned. Everything in TEN-1's plan rests on it.
2. **The seed-id rotation** (Consequences, last bullet) — file it as a P1 now, or fold it into AUTH-1's
   household-claim correction, which already touches those rows? It is live either way and it is not an
   addressing question.

## Decision

> **Chosen option:** ☐ A (session-only) ☐ B (path segment) ☐ other
>
> **Decided by:** _(the maintainer, date)_
>
> **Notes / amendments:**
>
> _Unsigned. Status stays **Proposed** until this box is filled, and TEN-1 does not start until it is
> (TEN-1's plan makes this ADR its chunk 0)._

## Review-response log (adversarial panel)

Five lenses — correctness, simplicity/scope, architecture, reuse, **security** (this decides where
authorization comes from, on a public repo with existence-only scoping today). No UX panel: nothing
user-facing changes, and wrong-household reuses the existing `notFound()` / `NO_PROFILE_LOG` path. The
one user-visible consequence a lens surfaced — the picker not naming its household — is recorded under
"What fails loudly" rather than filed.

**No lens challenged the decision.** All five would sign option A; every finding was about the
document. The first draft's defects clustered in three places: it cited documents this same PR was
editing, it rested the 404 argument on an inverted premise, and it restated reasoning that already had
a home.

| #      | Lens                   | Critique                                                                                                                                                                                     | Verdict                                  | Resolution                                                                                                                                                                                                                                                |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Correctness            | Two verbatim quotes attributed to `beta-1.md:46` — a cell **this PR rewrote into a pointer back at this ADR**. The sourcing was circular.                                                    | **accepted**                             | Both quotes deleted; the incident class is cited to its primary sources, and the "two prior incidents" framing to TEN-1's plan → "Out-of-scope / deferred".                                                                                               |
| **C2** | Correctness            | ~20 `path:line` cites resolve to unrelated text — `plan.md`'s by 8–20 lines, because this PR's own edits moved them.                                                                         | **accepted, and generalised**            | Every cite into a doc this PR edits is now **by section**, stated as a citation policy in the header. Code cites re-verified; `SECURITY.md` off-by-one fixed.                                                                                             |
| **C3** | Correctness · Security | The existence-oracle argument is inverted: committed seed ids are the case where 403 leaks _least_, and the cited source calls them "harmless".                                              | **accepted — argument rebuilt**          | Rebuilt on the repo's own "one answer for three states", with `NO_PROFILE_LOG` as the third precedent. The leaked-id threat replaces non-enumerability.                                                                                                   |
| **C4** | Correctness            | "2 consumers of `APP_HOME_PATH`" — there are 5 code sites including the proxy and **both screenshot scripts' default route**, plus 20 e2e references.                                        | **accepted**                             | Counted properly in the table; the screenshot default is called out, since that tooling is the mandated UI-PR procedure.                                                                                                                                  |
| **C5** | Correctness · Reuse    | The proxy rule was paraphrased in backticks with the `GATE_PATH` disjunct dropped; deleting it costs **two** hops and breaks **two** tests.                                                  | **accepted**                             | The real condition is quoted from `proxy.ts:79`, both hops and `proxy.test.ts:36-44` named.                                                                                                                                                               |
| **C6** | Correctness            | "The link is shareable between two parents" is true of the design but **not of Beta 0** — AUTH-1 ships one member; a second parent is Beta 1.                                                | **accepted**                             | Claim scoped explicitly, and the landed `plan.md` table correction moved out of Consequences into Context.                                                                                                                                                |
| **C7** | Correctness            | "Six route files" contradicted the table's own count, which treats `loading.tsx` as one.                                                                                                     | **accepted**                             | Context now says six **routable paths** and names the non-addressable files.                                                                                                                                                                              |
| **C8** | Correctness            | Two of three "reproducible" command annotations did not match their own output.                                                                                                              | **accepted**                             | Annotations corrected; the `href` grep's 10-vs-5 discrepancy is explained by the one builder feeding two attributes.                                                                                                                                      |
| **S1** | Security               | Option A's claim credits the 8 `getProfileByPublicId` callers and never names the 9th — the picker, which under A has **no second factor at all**.                                           | **accepted — the best finding here**     | "8 of the 9" restored, the ninth named, and the picker made a **named obligation** of this decision with a two-household `db:verify` case.                                                                                                                |
| **S2** | Security               | A single scoped predicate makes a cross-household probe **permanently undetectable** — the #1 risk becomes the one event with no signal, and two docs were about to ratify it.               | **accepted — decided here**              | New "What the server records": re-resolve without the conjunct on the miss path only, emit one structured event, no values. Externally still 404.                                                                                                         |
| **S3** | Security               | The 404 rationale rested on non-enumerability — but the seed `public_id`s have **zero entropy**, and `rate-limit.ts` already leans on that same false premise.                               | **accepted; premise dropped, gap filed** | The premise is gone from the ADR (see C3) **and** the live gap is filed as a P1 in Consequences — it survives the premise that found it.                                                                                                                  |
| **S4** | Security               | Session-only makes every URL household-independent, so every cache becomes the cross-household channel — guarded only by a `force-dynamic` justified by the CSP nonce and pinned by no test. | **accepted**                             | Option A's cost 2, with two named obligations; `revalidatePath`'s immunity (globally unique profile ids) stated, since it is non-obvious and load-bearing.                                                                                                |
| **S5** | Security               | The authorization section reads present-tense, but there is no session and no `household_members` today; TEN-1 buys consistency, not isolation.                                              | **accepted**                             | Explicit ⚠️ paragraph, including the singleton scope, the dark-on-≥2 behaviour as a sequencing constraint, and TEN-1's "most likely to over-claim" warning.                                                                                               |
| **S6** | Security               | The `/v1` 403 carve-out was asserted, not derived — a household-scoped token is subject to the same oracle, on the surface feeding an LLM.                                                   | **accepted — strengthened**              | Scoped the **rule** instead: 403 only inside the caller's own household, 404 otherwise. Edited into `SECURITY.md` in this PR.                                                                                                                             |
| **S7** | Security               | "What this does not settle" omitted separation _inside_ a household, which A makes the session solely responsible for.                                                                       | **accepted**                             | New bullet with `pin_hash`, the shared-phone case, and the note that it is identical under B so it argues for neither.                                                                                                                                    |
| **S8** | Security               | The one-way-door framing was asymmetric — A's caching obligation grows with the app, B's proxy deletion is paid once.                                                                        | **accepted**                             | Added as option A's cost 3.                                                                                                                                                                                                                               |
| **P1** | Scope                  | Recommendation reason 3 (_"the price does not rise"_) is refuted by the ADR's own foreclosure section 110 lines later.                                                                       | **accepted**                             | Reason 3 rewritten to name the rising bill: the sweep, plus a redirect route, plus a second path shape.                                                                                                                                                   |
| **P2** | Scope                  | 432 lines to decide one binary question, against a house bar of ~190–380 for seven or eight.                                                                                                 | **partly accepted**                      | ~100 lines of restatement cut (diagram section, two already-settled sections, option D, line enumerations, four open questions). The security lens then added three obligations the first draft lacked, so the net is flat — and that is the right trade. |
| **P3** | Scope · Architecture   | A Mermaid diagram in an ADR was already ruled out by ADR 0005's own panel.                                                                                                                   | **accepted**                             | Diagram removed; it ships in the PR description, which AGENTS.md requires anyway. The one novel sentence moved into option B.                                                                                                                             |
| **P4** | Scope                  | "Name the household on the picker" appeared four times in three incompatible states, for a population of zero.                                                                               | **accepted**                             | Collapsed to one conditional sentence; the open question and the row are gone. Noted against AUTH-1.                                                                                                                                                      |
| **P5** | Scope · Reuse          | Two sections re-decided what ADR 0005 and the backlog table already settle.                                                                                                                  | **partly accepted**                      | Both cut to three or four lines. **Pushback:** not deleted — this ADR was explicitly asked to say whether it affects TEN-2 and to answer 0005's deferred route question, and "go read the table" is not an answer a later reader will trust.              |
| **P6** | Scope                  | Four options where there are two; D is a straw man nobody proposed.                                                                                                                          | **accepted**                             | Two options. C became the forward-path paragraph under "Does this foreclose anything?"; D is one sentence inside B.                                                                                                                                       |
| **P7** | Scope · Security       | A one-clause `SECURITY.md` fix was discussed in three places and deferred to a code PR, leaving a live contradiction.                                                                        | **accepted**                             | Edited in this PR, and strengthened per S6. The three deferral paragraphs are gone.                                                                                                                                                                       |
| **P8** | Scope                  | Five open questions, four of which carried the author's own recommendation.                                                                                                                  | **accepted**                             | Four decided in the text; Q1 plus the S3 row remain.                                                                                                                                                                                                      |
| **R1** | Reuse                  | The strongest argument ignored the committed guard that already covers the incident class — `pages-are-gated.test.ts` is glob-driven, so a new path shape is covered automatically.          | **accepted, and probed**                 | Guards credited; residual narrowed to a deliberate `PUBLIC_PATHS` addition, the still-open matcher `/api` half, and the top-level-namespace issue. **Verified by probe**: a throwaway un-gated page fails that spec by name.                              |
| **R2** | Reuse                  | The measured counts were copied into four documents, only one carrying its provenance.                                                                                                       | **accepted**                             | The numbers live only here. `beta-1.md` and the changelog fragment now say the ADR measures them and link it.                                                                                                                                             |
| **R3** | Reuse                  | The table counted _mentions_, not definitions: 2 of the "4 redirects" resolve the gate through `GATE_PATH`, and 11 of the "31 files" consume two single-sourced e2e constants.               | **accepted**                             | Table split into "definitions that would change" vs "files that merely mention", with the note that prior centralisation already absorbed part of the sweep.                                                                                              |
| **R4** | Reuse                  | The 404 section specified the Server-Action envelope in prose and missed `NO_PROFILE_LOG`, the constant that already _is_ it — and it is module-local, so TEN-1 would re-type it.            | **accepted**                             | Named as the third precedent, with the promotion to `lib/constants.ts` as a consequence.                                                                                                                                                                  |
| **R5** | Reuse                  | The diagram invented an `isLiveProfile` signature and a SQL gloss for a predicate whose whole purpose is one definition.                                                                     | **moot**                                 | The diagram left the ADR (P3). The PR's diagram labels the node and points at `ten-1-household-scope.md` for the signature.                                                                                                                               |
| **R6** | Reuse                  | A consequence claimed the `plan.md` table "is corrected" while the diff only appended prose beside the untouched ❌, in two places.                                                          | **accepted**                             | The table cells are edited; the two prose blocks collapsed to one footnote and one pointer.                                                                                                                                                               |
| **R7** | Reuse                  | Prefer `file` + symbol over `file:line` for code, since lines drift.                                                                                                                         | **partly accepted**                      | Section cites for the edited docs (C2) and symbol names where one exists. **Pushback:** line cites kept for stable code, because the brief asks for them and a reviewer checking a count wants the line.                                                  |
| **R8** | Reuse                  | The picker fix was specified onto a static-string constant and onto `HouseholdScope`, the type built to make a request-supplied id a type error.                                             | **accepted**                             | Rewritten: the `PICKER_COPY` **function-member** idiom, and the household name on the picker's **read DTO**, never on the scope.                                                                                                                          |
| —      | Reuse · Correctness    | `export/route.ts:18-19`'s docblock still quotes the **unanchored** matcher that OSS-2 replaced.                                                                                              | **accepted, filed separately**           | Found outside this diff; a one-line docblock fix belongs to whoever next touches that file, not to an addressing ADR. Its substantive point (the `/api` half is open) is correct and is cited.                                                            |
| —      | Correctness · Security | TEN-1's plan carries two of the same wrong cites this ADR inherited (its chunk 0 row and its Q5).                                                                                            | **noted, not fixed here**                | TEN-1's plan is not this PR's file and its panel has not run. Flagged for that panel so the errors are not re-propagated.                                                                                                                                 |
| —      | Correctness            | Option B's cost omitted that choosing it requires un-writing the four pointers this PR writes.                                                                                               | **accepted**                             | Stated in the header's disclosure **and** in option B's cost list — it is the sharpest test of "written to be decided".                                                                                                                                   |

### Architecture lens (round 2 — it reviewed the first draft, mid-rewrite)

The architecture lens reported last and **against the pre-rewrite draft**, saying so itself: the file
moved under it and it watched four citations get fixed mid-review. Its A1 (stale `plan.md` lines), A3
(the diagram), A6 (the inflated redirect count) and half of A8 were already resolved by the rewrite
above — recorded here rather than claimed as fixes, because a log asserting a change the lens did not
ask for is as misleading as one asserting a change that never landed. **Five findings survived the
rewrite, and three of them changed the document's conclusions.**

| #      | Lens         | Critique                                                                                                                                                                                                                                                                                      | Verdict                                 | Resolution                                                                                                                                                                                                                                                                    |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2** | Architecture | The PR pre-applies its conclusions — and the `SECURITY.md` edit **hardens the security baseline citing a document whose status is "unsigned"**. The 404 is as option-independent as Decision 0, but only Decision 0 said so.                                                                  | **accepted — the sharpest of the five** | The header now splits **"decided now because it holds under every option"** (the segment rule, the 404) from **"the one unsigned choice"**, and names the two landed edits as landed. Open question 4 and the three "rides with TEN-1" deferrals are gone.                    |
| **A4** | Architecture | "What this settles for ADR 0005" answered the wrong question: 0005 deferred **four** routes for **two** reasons, and option A **removes the second one** — so a household-grain route becomes newly _defensible_, not forbidden.                                                              | **accepted**                            | Section rewritten: under A a household-grain surface is permitted at a top-level path with **no** segment, because the session supplies the scope. All four routes assigned — `/p/<id>/program` stands, `/movements` → TEN-2, `/calendar` → SCHED-1, `/home` already shipped. |
| **A5** | Architecture | COACH-1 was declared "not foreclosed" on a costing that only covers multi-**membership**. A grant is not membership: it needs the seam's **return type** to widen, not its argument list.                                                                                                     | **accepted**                            | Paragraph split in two. The ADR now asks TEN-1 only that `HouseholdScope` stay a **branded record** rather than a naked `household_id` — which TEN-1's design already does — and leaves COACH-1's seam shape to COACH-1.                                                      |
| **A7** | Architecture | HH-1 was left **half-superseded** in the two places this ADR claims to fix: PROF-1's sequencing warning and HH-1's own "Sequencing:" line had no pointer, and TEN-1's chunk-0 row still said the ADR "records" a recommendation and "supersedes HH-1".                                        | **accepted**                            | ⏳ pointers added to both `plan.md` rows; TEN-1's chunk-0 row, Q1 and Q5 amended — chunk 0 now says "argues, not records", "URL clause only", and carries the three obligations this ADR creates.                                                                             |
| **A8** | Architecture | TEN-1's Q5 says _"record the forward path in ADR 0006"_, and the first draft restated Q5 instead — two copies, neither pointing at the other.                                                                                                                                                 | **accepted**                            | The ADR is now the **owner**; Q5 reduced to a link in TEN-1's plan, in this PR.                                                                                                                                                                                               |
| —      | Architecture | `docs/architecture.md` **§2b is the committed home for this exact flow** and the ADR never cited or reconciled it; the first draft's own diagram also drew 404-on-unauth where a page actually redirects to `/gate`, and put `isLiveProfile` inside `lib/dal` when it lives in `packages/db`. | **accepted**                            | §2b is now cited, with the note that TEN-1 (chunk 1d) owns its update and that the PR's diagram is drawn to agree with it. Both flow corrections are stated as facts about the flow, not just about the picture.                                                              |
| —      | Architecture | The roadmap files this ADR under Product & Spec while it is chunk 0 of a Profiles & Tenancy plan — defensible, but unstated.                                                                                                                                                                  | **accepted**                            | Said out loud in `roadmap.md` → Seams.                                                                                                                                                                                                                                        |
| —      | Architecture | A personal name survived in `beta-1.md:46`'s **rewritten** cell.                                                                                                                                                                                                                              | **accepted**                            | Fixed to "the maintainer" before the lens reported. Pre-existing names elsewhere are left alone — AGENTS.md's rule is going-forward.                                                                                                                                          |
| —      | Architecture | `beta-1.md:228` is cited for the 404 criterion; the text is at `:230`. Table-internal line cites in TEN-1's plan are the most shift-prone targets in the repo.                                                                                                                                | **accepted, generalised**               | Both now cited by **section / question id** rather than line, which also closes the C2 class for the one file C2 had not reached.                                                                                                                                             |

**No blocking concern survives round 2.** Every lens would sign option A. The two things this panel
produced that the ADR did not previously contain — the picker as a named obligation (**S1**), and the
cross-household event that the chosen query shape would otherwise have made impossible (**S2**) — are
obligations on TEN-1 that exist because the panel ran, which is the argument for running it on a
document that writes no code.
