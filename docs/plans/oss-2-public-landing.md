# OSS-2 — a public landing screen at `/`

> Backlog: [plan.md](../plan.md) row OSS-2. Branch: `feat/oss-2-public-landing`.
>
> **Shipped plan-only (#208), before any implementation code** — the pattern `docs/plans/README.md`
> allows. §A follows in its own PR; where a section below says "this PR", it means the PR that
> implements that section.
>
> **Reshaped by two panel rounds.** Eight lenses (correctness, scope, architecture, reuse, security,
> and the three UX lenses) found two blocking defects in the first draft — a hero image that is a 400
> for every caller, and an acceptance criterion that could not fail. Both are fixed below; the
> review-response log at the bottom keeps the pushbacks.

## Goal

`mat-plan.dev` is linked from Ray's resume. Today every route is gated
([access-gate.ts:93](../../apps/web/lib/access-gate.ts) — "⚠️ There is no public path"), so a hiring
manager who clicks that link gets a bare password prompt reading "Private preview. Enter the household
access code to continue." with no explanation of what the thing is. This PR makes `/` a **public,
unauthenticated screen** that says what mat-plan is and links the source. The app itself stays gated,
unchanged.

## Acceptance

Verbatim from the new `docs/plan.md` row:

> **OSS-2 — a public landing screen at `/`.** An unauthenticated visitor (the resume link) gets a page
> that says what mat-plan is and a link to the source — instead of a bare password prompt. The profile
> picker moves to `/p`. The gate is unchanged and still guards every other route.

Done when:

- Un-gated `GET /` returns the landing — no redirect to `/gate`, no 404.
- **The landing reads no cookies and makes no database query.** It renders identically for every
  caller, so there is no branch that could serve household content publicly.
- Gated `GET /` lands on `/p` (the picker). Un-gated `GET /p` still redirects to `/gate?from=%2Fp`.
- Un-gated `GET /` **with a prefetch header** is 200 and contains none of the app's content; every
  **gated** route still bounces with a prefetch header (SEC-1's property, widened — see §Test plan).
- **An un-gated `POST /` carrying a real `Next-Action` id neither mutates nor leaks internals**, and
  the landing's module graph (root layout included) imports no `'use server'` module. `/` is now an
  unauthenticated POST endpoint, not just a render — see §The landing is also a public POST endpoint.
- **Every `app/**/page.tsx` either calls `requireGatedPage()` or is listed in `PUBLIC_PATHS`** —
  asserted by a test, not by prose.
- A successful gate login with no `?from=` lands on `/p` directly — **one redirect, not two**, and not
  via the public page.
- The landing passes axe A+AA at **360px and 390px** in a context with no gate cookie, and **its two
  CTA links are measured ≥44px by an assertion that fails when they are not** (see C2 in the log —
  `expectTapTargets` cannot see them).
- `/gate` is axe-scanned too: this PR makes it screen two of a public flow.
- Both CTAs are **in the viewport without scrolling** at 390×844.
- `pnpm verify` green; `pnpm e2e:local` green (this PR changes what the smoke's shared gate helper
  waits for, so the smoke is squarely in scope).

## Scope: this is two concerns, and the second one is bigger than it looks

The draft was one PR. The panel's scope and correctness lenses both called it over budget, and the
probe below explains why: **serving a public static asset through a gate-aware proxy is a separate
problem from making a route public**, and it is currently broken app-wide. So:

**Decided (Ray, 2026-10-01): two PRs, and §B waits for an OSS-1 rename.**

|        | Concern                                                                                          | Ships       |
| ------ | ------------------------------------------------------------------------------------------------ | ----------- |
| **§A** | The public landing route: `/` public, picker → `/p`, copy, links, a11y, the e2e move             | **next**    |
| —      | **OSS-1 follow-up:** rename the seed fixtures' real first names to neutral ones                  | next, small |
| **§B** | The hero image: un-gating a `public/` asset, the capture tooling, OG metadata, the committed PNG | after that  |

§A alone fixes the stated problem — the resume link stops resolving to a password prompt. §B is where
the privacy risk (a committed PNG in a public repo), the `next/image` defect and ~half the file churn
live.

**The ordering is deliberate: the seed rename comes between them.** With neutral fixture names in the
seed, §B needs no rename step, no allowlist and no throw-on-mismatch guard — the safety becomes
structural rather than bolted on. Doing §B first would mean building that guard and then deleting it.

---

# §A — the public landing route

## Design decision: `/` is public, the picker moves to `/p`

| Route            | Who        | Content                                                            |
| ---------------- | ---------- | ------------------------------------------------------------------ |
| `/`              | **anyone** | the landing. Zero cookie reads, zero DB access.                    |
| `/p`             | gated      | the profile picker, moved verbatim from today's `app/page.tsx`.    |
| `/p/[profileId]` | gated      | unchanged.                                                         |
| `/gate`          | anyone     | unchanged, plus a link back to `/` and `robots: { index: false }`. |

### Alternatives considered and rejected

The first draft claimed these "were weighed (below)" and never wrote them down (UX1-4). They are:

- **Alt A — leave `/` as the gate; add the explanation and the source link to `/gate` itself.**
  Genuinely the cheapest: one file, no new route, no proxy rule, no picker move, no churn in
  `gate-login.ts` / `global.setup.ts` / `a11y.spec.ts` / `gate-prefetch.spec.ts`, and the family's path
  is unchanged. **Rejected** because a visible password field remains the first thing ~100% of visitors
  see and cannot use — the exact first impression this PR exists to fix — and because it leaves the
  app's only unauthenticated password oracle as the landing surface for bot traffic, behind a rate
  limiter that deliberately fails open ([lib/rate-limit.ts](../../apps/web/lib/rate-limit.ts)). The
  split also buys the branchless, zero-DB, zero-cookie property the acceptance criteria rest on.
- **Alt B — `/` 307s to the GitHub repo.** Zero maintenance; the payload is the already-written
  README. **Rejected** on both audiences: the family loses its entry point, and a resume link that
  bounces to github.com reads as "there is no deployed app" — discarding the one proof the landing
  uniquely offers, that it runs.
- **Alt C — one route, branching inside it** (landing when un-gated, picker when gated). Zero e2e
  churn. **Rejected**: the public/private boundary becomes an `if` inside a page that also queries
  profiles, one inverted condition away from serving kids' names to the internet.

### The gated-visitor redirect lives in the proxy, not in the page

`proxy.ts` already has the mirror-image rule (`authed && pathname === GATE_PATH → '/'`,
[proxy.ts:95](../../apps/web/proxy.ts)); this adds `authed && pathname === '/' → APP_HOME_PATH`
alongside it. Two reasons it does not belong in `page.tsx`:

1. **It keeps the public page branchless.** `app/page.tsx` ends up with no conditional at all and
   nothing private in scope.
2. **A page-level `redirect()` under `force-dynamic` is not a clean 307.** The root layout sets
   `export const dynamic = 'force-dynamic'` for the CSP nonce
   ([layout.tsx:25](../../apps/web/app/layout.tsx)), and `docs/lessons.md` records that this makes Next
   **stream the 200 header before the RSC throws** — which is why `notFound()` returns 200 here. A
   page-level redirect would flash landing HTML at the family on every visit.

This is **not** the proxy acting as an authorization boundary (CVE-2025-29927; the SEC-1 lesson in
[lib/dal/gate.ts](../../apps/web/lib/dal/gate.ts)). It is convenience routing between two pages the
caller is already entitled to see.

⚠️ **The asymmetry claim, corrected.** The draft said "if the proxy rule is deleted, nothing opens."
Three lenses showed that is true for _security_ and false for _navigation_: with the rule gone, the
in-app back link and four specs would land on the public page, and one a11y test would stay green while
silently measuring the wrong screen. **So every `'/'` that means "the app home" is converted to
`APP_HOME_PATH` in this PR** (see the file list) — which restores the property the argument assumed.

### Where this sits against HH-1 (which the draft never cited)

[HH-1](../plan.md) is a **made decision**: the household id lives in the **path**, and its own sketch
assigns `/` to sign-in and the picker to `/<household-id>`. [beta-1.md](../milestones/beta-1.md) then
recommends reversing it to session-only and keeping `/p/<profileId>`, and files the ADR as "first thing
in Beta 0". OSS-2 does not settle that, and does not need to — `/p` as the index of the existing `/p/…`
namespace is correct under both branches.

**What is branch-specific is the constant and the proxy rule.** Under path-addressing, "home" becomes
`/<household-id>`, which is session- and DB-derived; the proxy has `env` and a cookie, no DB and no
session, so it _cannot_ compute it. The next author must then **delete** the proxy rule and move the
decision into a page that can resolve membership — not extend the proxy, which is the
proxy-as-authorization mistake arriving through the back door. That constraint is recorded in the
`APP_HOME_PATH` docblock so it travels with the code.

### The public-path exemption

DUALS-1 removed the last public path and left the lesson in
[access-gate.ts:86-93](../../apps/web/lib/access-gate.ts): match the **segment exactly**, never
`startsWith('/x')`, which would also open `/xsecret`.

**Exact membership only — no prefix arm.** The draft's `isPublicPath` carried a
`pathname.startsWith(`${p}/`)` branch that, with `PUBLIC_PATHS = ['/']`, was unreachable: TypeScript
narrows `p` to `never` inside the guard. Scope, reuse and correctness all flagged it as an abstraction
whose only interesting branch was dead and therefore asserted by nothing. The shape ships as exact
membership, with the segment lesson kept as prose for whoever adds `/sign-in`:

```ts
/**
 * Routes served WITHOUT the gate. Exactly one in §A: the public landing at `/`.
 *
 * EXACT membership, deliberately — no prefix matching. DUALS-1's lesson is that a public path must
 * match the SEGMENT exactly (`p === '/x' || p.startsWith('/x/')`), never `startsWith('/x')`, which
 * would also open `/xsecret`. Rather than ship a prefix arm no entry can reach, this matches exactly;
 * when a path with children arrives (`/sign-in/callback` at AUTH-1) the arm is added together with the
 * negative test that proves `/sign-inevil` stays gated.
 *
 * AUTH-1 inherits this list as "routes that need no session".
 */
export const PUBLIC_PATHS = ['/'] as const;

export function isPublicPath(pathname: string): boolean {
  return (PUBLIC_PATHS as readonly string[]).includes(pathname);
}
```

The negative tests are now non-tautological against exact matching: `/p`, `/gate`, `/profile`, `//`,
`/%2F`, `/ `, `''`. (§B adds `/landing/` as a _prefix_ entry for the asset directory, which is what
finally gives the segment arm a real positive case — `/landing/x` public, `/landingsecret` gated.)

**Path normalization was checked against the pinned source, not assumed.** In `next@16.3.7`,
`resolveRoutes` normalizes repeated slashes and backslashes **before** middleware and emits a
_redirect_ (`resolve-routes.js:103-110`); trailing-slash handling is likewise a redirect;
percent-encoding is left intact, so `/%2F ≠ /`; and route matching is case-sensitive. Every
normalization re-enters the proxy, so none of them can smuggle a gated path in under a `pathname` of
`/`.

### 🔴 Also fixing: the gate matcher itself is a prefix match — the exact error this PR's thesis is about

Pre-existing, found by the security lens, and **measured**:

```
/api  /api/x        → skipped (intended)
/apiary  /apifoo    → SKIPPED (not intended)
/favicon.icon       → SKIPPED
/_next/imagex       → SKIPPED
```

[proxy.ts:120](../../apps/web/proxy.ts)'s lookahead `(?!api|_next/static|_next/image|favicon.ico)` is
unanchored at its tail, so it excludes any path merely _starting_ with those strings. Impact today is
bounded — no such routes exist, and every page re-checks the gate — but `docs/tech-debt.md` records
this exclusion as segment-scoped, which it is not.

**Fixed here**, against the usual one-concern instinct, for one reason: this PR's entire thesis is that
a public path must match the segment exactly, and it would be incoherent to write that lesson into
`isPublicPath` while leaving the same bug in the matcher three lines away. It is one character class —
`(?!api(?:/|$)|_next/static/|_next/image|favicon\.ico$)` — and it ships with the four negative cases
above pinned in `access-gate.test.ts`.

### The landing is also a public POST endpoint, not just a public render

Server Actions POST to the current URL, and in `next@16.3.7` the action module map is **global, not
page-scoped**: `createServerModuleMap()` takes no page argument
(`app-render/manifests-singleton.js:195,302`), and an action id not registered for the current page is
**forwarded** to the page that owns it (`action-handler.js:128-166`). So `/` becoming public makes it
an unauthenticated POST surface.

Two layers hold, and both are load-bearing — this is depth, not redundancy:

1. a forwarded action's internal `fetch` targets `/p/[profileId]`, which is not public, so the proxy
   307s it; and
2. every action re-checks the gate itself
   ([actions.ts:84,167,270,366,439,498,568](../../apps/web/app/p/[profileId]/actions.ts)) — the SEC-1
   property in [lib/dal/gate.ts](../../apps/web/lib/dal/gate.ts).

**What is newly true:** any `'use server'` module that enters the landing's graph — including via
`app/layout.tsx`, which is in every page's entry — would be invokable by an unauthenticated POST to
`/`, with only its own `hasGateAccess()` in the way. And `/` becomes the only internet-reachable POST
with no rate limit (`checkRateLimit` guards the gate action alone). Hence the two new acceptance
criteria: the un-gated `Next-Action` POST test, and the no-action-imports invariant.

### The gated-page invariant becomes a test, not a sentence

Today the rule is total: all three pages call `requireGatedPage()`. OSS-2 creates the **first
exception**, and prose plus a unit test of a pure string function would not notice a future page that
forgets the call. So: a test globs `apps/web/app/**/page.tsx` and asserts each file either contains
`requireGatedPage` or has its route in `PUBLIC_PATHS`. That is the test that would have caught DUALS-1's
merge accident (#153), where the proxy half of a change was squashed away and nobody noticed until a
human visited the route.

## File-by-file changes (§A)

| Path                                                      | Change  | What & why                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/constants.ts`                               | EDIT    | `APP_HOME_PATH = '/p'` (AGENTS.md puts route paths here; `access-gate.ts` is the module AUTH-1 **deletes**, so the app's home route must not live in it). Plus `PICKER_COPY` (heading + subhead) and `GITHUB_REPO_URL`.                                                                                                                                                               |
| `apps/web/lib/access-gate.ts`                             | EDIT    | `PUBLIC_PATHS` + `isPublicPath` (gate policy, correctly at home here). Replaces the "there is no public path" block, keeping its lesson. Module stays dependency-free and Edge-safe.                                                                                                                                                                                                  |
| `apps/web/lib/access-gate.test.ts`                        | EDIT    | `isPublicPath` positive + the seven negatives above. One contract test pinning `APP_HOME_PATH === '/p'`, and one pinning `PUBLIC_PATHS` as exactly `['/']` so adding an entry is a deliberate, visible test edit (C6). Plus the four matcher negatives (`/apiary`, `/apifoo`, `/favicon.icon`, `/_next/imagex`).                                                                      |
| `apps/web/proxy.ts`                                       | EDIT    | Un-gated bounce becomes `… && !isPublicPath(pathname)`. New `authed && pathname === '/' → APP_HOME_PATH` rule; the authed-on-`/gate` target becomes `APP_HOME_PATH`. **Delete the now-dead `if (pathname !== '/')` guard** on the `from` param (unreachable once `/` is public). **Anchor the matcher lookahead** (above). Security headers unchanged on every path, public included. |
| `apps/web/app/pages-are-gated.test.ts`                    | NEW     | Globs `apps/web/app/**/page.tsx`; each must contain `requireGatedPage` or be listed in `PUBLIC_PATHS`. Turns the SEC-1 invariant from prose into a gate now that the first exception exists.                                                                                                                                                                                          |
| `apps/web/app/page.tsx`                                   | REWRITE | The landing (shape below). No `requireGatedPage`, no `hasGateAccess`, no DAL import, no `runtime` pin.                                                                                                                                                                                                                                                                                |
| `apps/web/app/p/page.tsx`                                 | NEW     | The picker, moved **verbatim** — `runtime = 'nodejs'`, `requireGatedPage()`, `listProfiles()` — reading its heading from `PICKER_COPY`.                                                                                                                                                                                                                                               |
| `apps/web/app/loading.tsx` → `apps/web/app/p/loading.tsx` | MOVE    | It is a `max-w-2xl` heading + two tile skeletons, documented as the picker/Today fallback. Left in the root segment it would front the **public landing** (which awaits nothing), paint an app skeleton at a different width, then jump — a CLS regression on the one page built for strangers.                                                                                       |
| `apps/web/app/gate/page.tsx`                              | EDIT    | A `<Link href="/">` back to the landing (the one room a stranger can walk into needs an exit), and `metadata: { robots: { index: false, follow: false } }` so a password prompt cannot become the public search result for "mat-plan". DUALS-1 set `X-Robots-Tag: noindex, nofollow, noarchive` on its public responses, so this is restoring a precedent, not inventing one.         |
| `apps/web/app/gate/actions.ts`                            | EDIT    | Resolve the post-login default at the call site: `const to = safeInternalPath(from); redirect(to === '/' ? APP_HOME_PATH : to)`. **`safeInternalPath` itself is untouched** — it is the hostile-input sink hardened in SEC-4 (#203) and its `'/'` return must stay safe.                                                                                                              |
| `apps/web/app/p/[profileId]/page.tsx`                     | EDIT    | `href={APP_HOME_PATH}` on "← All profiles" (line 131) — the kids' most-tapped control, which otherwise prefetches the public landing and takes a redirect round-trip on gym-floor signal.                                                                                                                                                                                             |
| `apps/web/e2e/gate-login.ts`                              | EDIT    | `waitForURL(APP_HOME_PATH)`; heading assertion via `PICKER_COPY.heading` (exact — retires the lossy `/Who.s logging today/` regex for the curly apostrophe).                                                                                                                                                                                                                          |
| `apps/web/e2e/global.setup.ts`                            | EDIT    | Two `goto('/')` → `APP_HOME_PATH`.                                                                                                                                                                                                                                                                                                                                                    |
| `apps/web/e2e/log-bodyweight.spec.ts`                     | EDIT    | Three `goto('/')` → `APP_HOME_PATH`; heading via `PICKER_COPY`.                                                                                                                                                                                                                                                                                                                       |
| `apps/web/e2e/a11y.spec.ts`                               | EDIT    | `ROUTES` picker entry → `APP_HOME_PATH`, **and** its `expectControls: route.path !== '/'` exception → `!== APP_HOME_PATH` (else the picker is suddenly asserted to have `<button>`s, which it has none of). `goto('/')` at line 470 → `APP_HOME_PATH`. New storage-state-free `describe` covering `/` **and** `/gate`.                                                                |
| `apps/web/e2e/gate-prefetch.spec.ts`                      | EDIT    | Gated loop widened to `APP_HOME_PATH`, `SEED_PROFILE_ROUTE`, `${SEED_PROFILE_ROUTE}/routine`, `${SEED_PROFILE_ROUTE}/export`; new public-path case; leak markers hoisted to one `APP_CONTENT_MARKERS` built from `BODYWEIGHT_COPY.heading` + `PICKER_COPY.heading` instead of two hand-typed strings.                                                                                 |
| `apps/web/e2e/landing.spec.ts`                            | NEW     | See §Test plan.                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/scripts/screenshot-ephemeral.ts`                | EDIT    | **Retire the `route === '/p'` → `SEED_PROFILE_ROUTE` shorthand** (line 787): it now shadows a real route, so `screenshot:ephemeral /p` would silently capture Today — a picture of the wrong screen, attached as evidence. Both script defaults (`?? '/'`) → `APP_HOME_PATH`; `/` is passed explicitly.                                                                               |
| `apps/web/scripts/capture.ts`                             | EDIT    | Skip `gateLogin(page)` when the route `isPublicPath()` (the landing cannot be captured through the gate — the proxy sends a gated caller to `/p`). Refresh the stale `timeZone` comment at :78 ("the gate login lands on `/`").                                                                                                                                                       |
| `.claude/skills/ui-screenshot/SKILL.md`                   | EDIT    | Drops the `/p` shorthand it documents at :26-31. `pnpm skills:check` enforces that a skill's cited paths and scripts are real.                                                                                                                                                                                                                                                        |
| `docs/plan.md`                                            | EDIT    | New OSS-2 row linking this plan.                                                                                                                                                                                                                                                                                                                                                      |
| `docs/status.md`                                          | EDIT    | "Where we are" pointer.                                                                                                                                                                                                                                                                                                                                                               |
| `docs/changelog/2026-10-01-feat-oss-2-public-landing.md`  | NEW     | The fragment `pnpm status:check` requires on a `feat/` branch.                                                                                                                                                                                                                                                                                                                        |
| `docs/architecture.md`                                    | EDIT    | **§2b "Profile routing"** (line 95) — its prose opens "`/` is the profile picker" and its Mermaid node is labelled `/ — profile picker`. (The draft named a "request-routing view" that does not exist.)                                                                                                                                                                              |

### The landing's shape

Server component, no `'use client'`, no state.

```
<main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
  <header>
    <MatPlanMark />                        — the brand mark, inline SVG (see below)
    <h1>mat-plan</h1>                      — the wordmark, as text
    <p class="max-w-prose">…</p>           — 2–3 sentences (structure pinned below)
  </header>
  <p class="max-w-prose">…</p>             — the one honest line about the gate, ABOVE the buttons
  <div class="flex flex-col gap-3">
    <Button asChild>          → GITHUB_REPO_URL + '#whats-interesting-here'
    <Button asChild variant="outline"> → GATE_PATH   — "Household sign-in"
  </div>
</main>
```

Four UX changes from the draft, each from a lens:

1. **The source link is primary; the gate is secondary.** The gate cookie lasts a year
   ([constants.ts:23](../../apps/web/lib/constants.ts)) and the new proxy rule sends any cookie-bearing
   visitor straight to `/p`, so the family sees this page roughly once a year per device. Making
   "Enter access code" the dominant control gave the emphasis to the ~1% who have a code and
   de-emphasised the only thing the other ~99% can do — reproducing the password-prompt rejection one
   screen later, in nicer clothing. The gate button is relabelled **"Household sign-in"** so a stranger
   self-selects out instead of tapping and bouncing, and it carries `?from=${APP_HOME_PATH}` so the
   post-login hop is explicit.
2. **`max-w-2xl`, not `max-w-md`.** Every other screen uses `max-w-2xl`; `max-w-md` (448px) renders as a
   phone-width ribbon on a laptop, which a resume link gets a meaningful share of the time. Text measure
   is capped with `max-w-prose` instead.
3. **No `sm:flex-row`.** The draft called the row "never load-bearing" — so it goes. `buttonVariants`'
   base carries both `shrink-0` and `whitespace-nowrap`, so in a row the CTAs can neither shrink nor
   wrap: they overflow. Two stacked full-width CTAs read fine at every width and delete the entire
   overflow class, which the CI gate could not have caught anyway (`expectNoHorizontalOverflow` reads
   `scrollWidth`).
4. **The gate explanation sits above the buttons**, not after them — below, it is read after the tap it
   exists to prevent.

**One link, not three.** The draft proposed three "what's interesting here" links. Four lenses
objected, on four grounds: they are a feature grid with the nouns removed; stripped of the README's
one-clause glosses they drop a phone reader into the middle of a long internal planning document;
anchors into `AGENTS.md`/`docs/` move when headings are edited; and one of the three (the AI authority
boundary) links to a **plan for unbuilt work**, which without a qualifier reads as shipped to a reader
who cannot log in and check. Resolution: **one** link, to the README's own curated section —
`#whats-interesting-here` — which is already written, already maintained, already honest about
`plans/` in its link targets, and skips GitHub mobile's file tree.

### Copy

**Lifted from the merged README (#202), with a property instead of a blocklist.** The draft said "don't
inherit the three stale claims #202 flagged". The trust lens found a fourth the blocklist missed — and
it is precisely the sentence an implementer would reach for, because it is the README's _only_ sentence
about the gate: _"currently behind an access gate while v1 finishes"_, which `docs/status.md`
contradicts ("the MVP finish line was crossed on 2026-09-24"). A blocklist of three known-bad sentences
is the mechanism that let those three go stale.

**The rule instead: the landing carries no claim whose truth depends on repo state** — no counts, no
dates, no "currently" / "next" / "until", no gate-status timeline, no roadmap. A reviewer can check
that; three avoided sentences they cannot.

Structure, pinned so implementation can't drift:

1. One clause of what it is — "Strength-and-conditioning logging for a parent coaching their own kids."
2. The hook, near-verbatim from `README.md:8-9`: _"in this system a bad number doesn't degrade a metric,
   it tells a child to lift something."_ This is the line that earns the click, and the draft would have
   buried it under two sentences of first-person framing.
3. "I **built it to replace** the trainer I was paying…" — **past tense**. The README's present-tense
   "It replaces" reads as origin story in context, but standing alone on a landing page it is a claim
   that the product works, with V1-30 and V1-27 open as P0s in the repo the adjacent button links to.
4. The gate line, as a **reason**, not a reassurance: roughly _"The app holds two kids' logged weigh-ins
   and training, so it stays behind a shared household code until real sign-in lands."_ It explains why
   the visitor cannot get in, says who the users are, and frames the shared code as a deliberate
   limitation rather than a security claim.

⚠️ **No security adjective** — not "secure", "protected", "encrypted", or "private and secure". The gate's
own file says "⚠️ **This is a DELIBERATE STOPGAP, not an authorization boundary**" and "statelessness is
acceptable for a stopgap deterrent", that file is public, and the page's primary button points the reader
at it. Any reassurance is falsified by the second file the visitor opens.

### The brand mark — inline SVG, deliberately not a `public/` asset

**Supersedes the original brief's "no logo work. A text wordmark is fine."** Ray supplied a mark
(2026-10-01), saved at `apps/web/public/brand/mat-plan-mark.{svg,png}` as the design source.

**The landing renders it as an inline React component, not as a fetched file.** This is the same trap
§B documents, arriving a PR early: a `<img src="/brand/mat-plan-mark.svg">` matches the proxy matcher
and is gate-redirected, and `next/image` does not rescue it — measured, 400 for every caller. Inlining
sidesteps the whole class:

|                | inline component                        | `public/` asset                      |
| -------------- | --------------------------------------- | ------------------------------------ |
| Works un-gated | ✅ nothing to fetch                     | ❌ needs a `PUBLIC_PATHS` entry (§B) |
| Network cost   | zero — 1,030 bytes in the RSC payload   | a second request                     |
| CLS            | none (intrinsic `viewBox`)              | needs explicit dimensions            |
| Theming        | `fill="currentColor"` follows the token | fixed `#F64D24`                      |

The source SVG is one `<g fill="#F64D24">` of five hand-authored paths with no raster, no filters and no
external refs, so the conversion is mechanical. The component takes the fill from a CSS token rather
than hard-coding the hex twice (AGENTS.md's constants rule — the colour is already a design token's
job), and carries `role="img"` + a `<title>`, since it sits beside the `<h1>` as decoration rather than
as the accessible name.

**The PNG stays unused in §A.** Its jobs — favicon and the OG card — both need the asset-serving work:
Next's `app/icon.png` convention generates a `/icon` route that the matcher gates, and an OG image must
be fetchable by a crawler that sends no cookie. Both land in §B with `metadataBase` and the
`PUBLIC_PATHS` prefix entry, where that problem is already being solved once.

### 360px arithmetic, by hand

The CI gate cannot do this: `expectNoHorizontalOverflow` reads `scrollWidth` (flex-wrap never trips it)
and `expectTapTargets` measures height only.

|                     | at 360px                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `px-4` both sides   | 360 − 32 = **328px** of content                                                    |
| `max-w-2xl` (672px) | not binding below 672 → no fixed width anywhere                                    |
| CTAs                | stacked at every width → each 328px, `min-h-11` (44px) from `buttonVariants`' base |
| `h1` `text-3xl`     | "mat-plan" ≈ 9ch at 30px ≈ 150px — no wrap                                         |
| prose               | `max-w-prose` not binding at 328px                                                 |

Nothing is in a row at any width, so nothing depends on wrap luck.

## Test plan (§A)

| Level                                   | Asserts                                                                                                                                                                  | Run              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Unit (`access-gate.test.ts`)            | `isPublicPath` positive + 7 negatives; `APP_HOME_PATH` pinned once; `PUBLIC_PATHS` pinned as exactly `['/']`                                                             | `pnpm verify`    |
| Unit (`access-gate.test.ts`)            | post-login default: no `from` → `APP_HOME_PATH`                                                                                                                          | `pnpm verify`    |
| Unit (`pages-are-gated.test.ts`)        | every `app/**/page.tsx` calls `requireGatedPage` or is in `PUBLIC_PATHS`                                                                                                 | `pnpm verify`    |
| E2E `landing.spec.ts`, no storage state | **un-gated `POST /` with a real `Next-Action` id**: no mutation, no internals in the response                                                                            | `pnpm e2e:local` |
| E2E `landing.spec.ts`, no storage state | un-gated `/` stays on `/`; the `h1`; the GitHub `href` (from `GITHUB_REPO_URL`); `/p` → `/gate?from=%2Fp`; **both CTAs `toBeInViewport()` at 390×844 before any scroll** | `pnpm e2e:local` |
| E2E `landing.spec.ts`, gated            | `/` ends on `/p` with `PICKER_COPY.heading`                                                                                                                              | same             |
| E2E `gate-prefetch.spec.ts`             | all four gated routes bounce with a prefetch header; `/` is 200 and contains no `APP_CONTENT_MARKERS`                                                                    | same             |
| A11y `a11y.spec.ts`, no storage state   | axe A+AA on `/` **and `/gate`** at 390 and 360; no overflow; **CTA link heights ≥ `MIN_TAP_TARGET_PX`**                                                                  | same             |

Three things the draft got wrong here:

- **The tap-target claim was unfalsifiable.** `a11y.spec.ts:75` defines
  `INTERACTIVE = 'button, [role="button"], select, textarea, input:not([type="hidden"])'` and
  deliberately excludes `<a>` (WCAG 2.2 SC 2.5.8's inline-link exception). `Button asChild` renders
  `Slot.Root`, which merges classes onto the `<a>` and adds **no `role="button"`** — so on the landing
  `controls.length === 0`, and `expectTapTargets` either fails on its own "selector is wrong" guard or
  is called with `expectControls: false` and iterates nothing. The landing's CTAs are measured the way
  the existing link-card test already measures profile tiles
  ([a11y.spec.ts:465-477](../../apps/web/e2e/a11y.spec.ts)): iterate
  `page.getByRole('main').getByRole('link')`, assert `box.height >= MIN_TAP_TARGET_PX`, with a
  `count > 0` guard so an empty page cannot pass.
- **Assert the final URL, never the HTTP status**, for any redirect that goes through a _page_:
  `force-dynamic` streams a 200 before the RSC throws (`docs/lessons.md`, V1-3 — why `notFound()`
  returns 200 here). The **proxy-level** redirects are real 3xx and must be asserted with
  `context.request.get(…, { maxRedirects: 0 })` on a fresh context, as `gate-prefetch.spec.ts` already
  does.
- **The `test.use` precedent was miscited.** `gate-prefetch.spec.ts:25` builds contexts by hand from
  the `browser` fixture; it never calls `test.use`. The describe-level `test.use({ storageState: {
cookies: [], origins: [] } })` is correct for the a11y and page-based blocks — and it must inherit the
  `a11y` project's `bypassCSP: true`, or axe's injected script dies against the nonce CSP.

This also closes a standing gap honestly: `/gate` has **never** been axe-scanned
([a11y.spec.ts:55](../../apps/web/e2e/a11y.spec.ts) excludes it because every test lands past it), and
this PR promotes it to screen two of a public flow.

---

# §B — the hero image (recommended as a follow-up)

## 🔴 `next/image` on a `public/` asset is broken in this app today — probe-verified

The draft argued `next/image` was a _correctness_ requirement because a plain
`<img src="/landing-today.png">` would match the proxy matcher and get gate-redirected. That half is
right. The conclusion — that `/_next/image` escapes it because the matcher excludes it — is **wrong**,
and three lenses traced why through the in-tree Next 16.3.7 source: for a local `url`, the optimizer
re-enters the router server (`next-server.js:787` → `fetchInternalImage` → `routerServerHandler`), the
`middleware` route runs before the filesystem check (`resolve-routes.js:58-64`), and the internal
request is built by `createRequestResponseMocks` with **no headers** (`mock-request.js:424`) — so no
gate cookie. The proxy returns a bodyless 307, and the optimizer throws
`ImageError(400, '"url" parameter is valid but internal response is invalid')`.

**Measured, against this branch's prod build (`next build && next start`):**

| Request                                         | No cookie                            | Valid `mp_gate` cookie |
| ----------------------------------------------- | ------------------------------------ | ---------------------- |
| `GET /_probe.png`                               | **307** → `/gate?from=%2F_probe.png` | 200                    |
| `GET /_next/image?url=%2F_probe.png&w=640&q=75` | **400**                              | **400**                |

So the image fails for **every** caller, gated or not — the app has never used `next/image` or served a
`public/` asset, so this path has simply never been exercised. **And the fix is verified too:** with the
asset path exempted in the proxy, both requests return 200 (`content-type: image/png`) with no cookie.

**Therefore the asset must be an explicit public path**, not a hoped-for optimizer side effect.
`next/image` stays, for CWV reasons only — and the draft's reasoning is corrected here so it cannot
send a future debugger the wrong way.

**The asset lives in `apps/web/public/landing/`, and `/landing/` is a PREFIX entry in `PUBLIC_PATHS`.**
Two things fall out: the segment arm of `isPublicPath` finally has a real positive case (`/landing/x`
public, **`/landingsecret` gated** — the DUALS-1 hazard, now actually asserted), and the exemption is
scoped to a directory rather than growing one entry per file.

**And `next.config.ts` gets `images.localPatterns`.** With `localPatterns` undefined, `hasLocalMatch`
returns `true` for **every** local path (`shared/lib/match-local-pattern.js`, `image-config.js:68`) —
so an un-gated optimizer would happily serve any `public/` file the proxy lets through. Setting
`localPatterns: [{ pathname: '/landing/**', search: '' }]` is the only thing that bounds what the
public optimizer will render.

OG crawlers settle it independently: LinkedIn/Slack/Twitter fetch the absolute URL in the meta tag,
never `/_next/image`, so without the exemption every preview card is imageless — which defeats the
point of a resume link.

## File-by-file changes (§B)

| Path                                       | Change | What & why                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/constants.ts`                | EDIT   | `LANDING_ASSET_PREFIX = '/landing/'`, `LANDING_IMAGE_PATH`, `SITE_ORIGIN`.                                                                                                                                                                                                                                    |
| `apps/web/lib/access-gate.ts`              | EDIT   | `LANDING_ASSET_PREFIX` joins `PUBLIC_PATHS` as the first **prefix** entry, re-introducing the segment arm with a live positive case and a `/landingsecret` negative.                                                                                                                                          |
| `apps/web/next.config.ts`                  | EDIT   | `images.localPatterns` scoped to `/landing/**` — without it the un-gated optimizer would serve any `public/` file (see above).                                                                                                                                                                                |
| `apps/web/app/layout.tsx`                  | EDIT   | `metadataBase: new URL(SITE_ORIGIN)` — unset, Next resolves relative OG URLs against `VERCEL_URL` or `localhost`, so the card a hiring manager sees from `mat-plan.dev` would reference a preview deployment. For a page whose whole job is to be shared from a resume, that is the one thing that must work. |
| `.github/workflows/ci.yml`                 | EDIT   | The e2e auto-skip treats `*.png` as provably inert (:343). This PR is what turns an image from a PR attachment into **served content on the only public route**, so the allowlist must stop covering `apps/web/public/` — otherwise a later PR that swaps only the PNG skips the smoke entirely.              |
| `apps/web/app/page.tsx`                    | EDIT   | The `<figure>` + `<Image>` + `<figcaption>`, and page `metadata` overriding **only** `openGraph` (title/description already inherit from `layout.tsx:16` — a second copy would be a second source for the site's own name and pitch).                                                                         |
| `apps/web/public/landing-today.png`        | NEW    | The committed asset. Intrinsic dimensions pinned in the PR description so a reviewer can redo the math.                                                                                                                                                                                                       |
| `apps/web/scripts/capture.ts`              | EDIT   | A `fullPage` opt-out. It is hardcoded `fullPage: true` at `deviceScaleFactor: 2`, so a Today capture is ~780 × several thousand px — rendered `w-full` in a 328px column that is ~1700px of image, two phone screens, with both CTAs below it. It is also an unreadable sliver as a ~1.91:1 OG card.          |
| `apps/web/scripts/screenshot-ephemeral.ts` | EDIT   | Neutral profile names applied **unconditionally** in `runEphemeral` after `migrateAndSeed`, parameterized (`$1`, never interpolated).                                                                                                                                                                         |
| `docs/plan.md`                             | EDIT   | Amend OSS-1's "❌ **No screenshots.** `git ls-files` returns 0 tracked files" bullet — this PR makes that false, and OSS-1 is the document Ray re-reads before deciding anything about published PII.                                                                                                         |

### The screenshot, and where the privacy guarantee actually comes from

**Decided: the seed fixtures are renamed first, in their own OSS-1 PR — so §B carries no rename at
all.** The draft added a `--state landing` fixture that renamed profiles for one capture; the scope lens
improved that to an unconditional rename in `runEphemeral`; the security lens then showed the whole
construction was aimed one step downstream of the problem.

**The kids' real first names are already published in this repo** — `packages/db/src/seed.ts:118-122`,
`e2e/global.setup.ts:32,39`, `e2e/steps.ts:25`. So any rename in the screenshot path guards a
disclosure that has **already happened**. Renaming the seed closes the actual exposure, and every
capture — this one, and every future PR screenshot — becomes safe because the fixture data simply
contains nothing private. No allowlist, no throw-on-mismatch guard, nothing to remember.

That matters beyond this asset: `publish-screenshots.ts` pushes PNGs to the `screenshots` orphan branch
on a **public** repo, and every seeded capture renders the profile name as the `<h1>`
([p/[profileId]/page.tsx:136](../../apps/web/app/p/[profileId]/page.tsx)) beside a weigh-in. The seed
rename fixes that whole class; a §B-local guard would have fixed one file.

**The captured screen's bodyweight is safe by construction** — the screenshot fixtures write committed
constants (`84.5` at `screenshot-ephemeral.ts:475`, chosen for a rendering property, per its own
comment), never real values. Scoped deliberately: this is a claim about **what the capture renders**,
not about the repo, which OSS-1's audit shows does hold 14 real dated weigh-ins in the legacy CSV
samples. A stronger claim than the draft's, and it narrows
the residual risk to names, which the rename then removes.

**Two controls still earn their place in §B**, because the rename does not cover them:

- **The script writes the asset to its final path** under an explicit flag, so the artifact's
  provenance is the command rather than a human `cp` from `.screenshots/` — the one manual step that
  could otherwise move a `--use-live-db` capture into `public/`.
- **A named pre-`git add` checklist**, because on a public repo the irreversible event is the **push**,
  not the merge: a blob stays fetchable by SHA through the PR after a force-push or a branch delete,
  and a squash merge does not unpublish it. Check: the `<h1>` name · the `DayNav` date line and week
  strip (which freeze a calendar date — `day-nav.tsx:63`) · the bodyweight section · any program card ·
  **every number in frame**.

**The image is labelled as sample data, in two places**, because it is also the OG image and a
`<figcaption>` does not travel to a LinkedIn unfurl: the caption ("Logging a strength session. Sample
data — real names and weigh-ins aren't published.") **and** `openGraph.description`.

**`alt` is specified here, because axe cannot judge it** — `image-alt` catches a missing attribute and
passes `alt="screenshot"`. For a blind visitor this image is the only evidence of a product they cannot
get behind the gate, so it describes what the screen _does_: _"The Today screen on a phone: a weigh-in
field, the day's check-in list, and a strength form with set rows for weight and reps."_

**`next/image` props, all four named** (`image.md` in the in-tree Next 16.3.7 docs): `sizes="(min-width:
672px) 640px, 100vw"` — without it a CSS-responsive image gets a fixed-size `srcset` and a DPR-2 phone
downloads a far larger candidate than it needs; and `loading="eager" fetchPriority="high"`, because the
image is above the fold and almost certainly the LCP element, while the default is `lazy`. **Not
`priority`** — deprecated in Next 16 in favour of `preload`, with `loading`/`fetchPriority` recommended
over both.

⚠️ **`--build` is mandatory on every capture.** `screenshot:ephemeral` only builds when
`.next/BUILD_ID` is absent, so with a warm build the capture silently shows `main`'s UI
(`docs/lessons.md`, GAP-1 P1-1c) — the exact failure of attaching an image as evidence for a change it
does not contain.

## Risks / rollback

| Risk                                                                                                                                                                                                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The public exemption covers more than intended.**                                                                                                                                                                                                        | Exact membership, seven pinned negatives, plus a contract test asserting `PUBLIC_PATHS` is exactly `['/']` so widening it requires a visible test edit. The landing queries nothing, and every other page and route handler self-checks the gate, so a wrong matcher degrades to today's behaviour.                                                                                                                                                                                                                                                                       |
| **A committed screenshot publishes a child's name or weight, permanently.**                                                                                                                                                                                | §B only. Ephemeral DB + unconditional rename to `Athlete A`/`B` + the named pre-`git add` checklist. Reviewed as a PR blocker, not a nit.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The picker move breaks the smoke in CI rather than locally.                                                                                                                                                                                                | Every `'/'` meaning "app home" converted to `APP_HOME_PATH`, so the specs fail loudly rather than passing via the proxy hop; `pnpm e2e:local` before the PR opens.                                                                                                                                                                                                                                                                                                                                                                                                        |
| A gated family member gets the landing instead of the app.                                                                                                                                                                                                 | Proxy redirect before any render. Worst case if it regresses: one extra tap, no data exposure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Committing an asset to `public/` contradicts AGENTS.md's "screenshots live in gitignored `.screenshots/`, never committed".                                                                                                                                | Genuine exception — a public page must serve its own image. Stated explicitly in the PR description; the asset goes in `public/` (a served-asset directory), not `.screenshots/`.                                                                                                                                                                                                                                                                                                                                                                                         |
| **The landing is the first public, un-cacheable, un-rate-limited SSR route.** `force-dynamic` is forced by the nonce CSP, and `layout.tsx:23`'s justification ("inherently per-user, nothing is statically cacheable") stops being true for this one page. | **Accepted explicitly**, against the LCP budget: one small RSC, no data fetch, a resume link is low volume, and Vercel's own protections sit in front. AGENTS.md's rate-limit list covers auth, mutations and sync — not this; revisit if bot traffic shows in Sentry. The named alternative is to emit a **nonce-free, `'self'`-only CSP for `isPublicPath` responses** and let the landing render statically with a long `s-maxage` — which would also remove the need for the `force-dynamic` redirect argument above. Deferred as a CSP change, not a landing change. |
| **`/` is now an unauthenticated POST surface** (Server Actions post to the current URL, and the action module map is global, not page-scoped).                                                                                                             | Two independent layers, both load-bearing: a forwarded action's internal fetch targets a non-public route and is 307'd, and every action re-checks the gate itself. Plus a new invariant — the landing's graph and the root layout import no `'use server'` module — and an un-gated `Next-Action` POST test.                                                                                                                                                                                                                                                             |
| The landing drifts from the README.                                                                                                                                                                                                                        | It carries no claim whose truth depends on repo state (see §Copy), and one link into the README rather than a copy of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Rollback:** revert the commit. Additive routing plus moved files; no schema, no migration, no data.

## Out-of-scope / deferred

- **Google / Clerk sign-in (AUTH-1).** Clerk is not installed at all (no dependency, no
  `middleware.ts`), and `beta-1.md` sequences `ADR: household addressing → TEN-1 → AUTH-1`, with AUTH-1
  itself carrying a `household_members` table, invitation-only sign-up and a guarded correction to claim
  Ray's household. Several PRs behind a decision not yet made. Its own plan.
- **An env flag that turns the gate off.** The original ask was "the gate stays, behind an env flag, so
  open beta is a flag flip not a code change." **Pushing back:** with no auth behind it, the flag's only
  reachable state is the dangerous one — flipping it publishes two children's logged health data, and
  `docs/plan.md`'s third sequencing finding says the gate is "the only thing between the internet and two
  kids' data". The landing solves the resume problem without it. The flag belongs in AUTH-1, where
  flipping it means "Clerk guards this now" and it is one line.
- **No recovery path for a family member who has lost the shared code** (wrong code → "Incorrect access
  code.", full stop; reissue is an env change plus a redeploy). Recorded as a known dead end the landing
  now fronts, so it is a decision rather than an omission. AUTH-1 fixes it with per-person identity.
- **`PAGE_SHELL` extraction.** The page-shell class string is already duplicated six times
  (`loading.tsx`, `page.tsx`, `error.tsx`, `gate/page.tsx`, `p/[profileId]/page.tsx`,
  `routine/page.tsx`); the landing is a seventh. Real, pre-existing, and a six-file refactor — its own
  chore PR, not smuggled into a routing change.
- **Folding `app/p/[profileId]/export/route.ts:35`'s inline cookie check into `hasGateAccess()`.** A
  genuine duplication (V1-13b), but changing a Route Handler's auth path inside a landing-page PR is the
  wrong PR. Filed, not fixed here.
- **Deleting `public/*.svg` and `apps/web/README.md`'s `create-next-app` boilerplate.** Dropped from the
  draft: unrelated scope in a PR already touching routing, gate-adjacent code and the e2e harness. A
  one-minute `git rm` chore whenever.
- A waitlist, email capture or newsletter (ruled out); a feature grid, pricing, testimonials;
  analytics; `robots.txt`/sitemap beyond the single `noindex` on `/gate`.

## Open questions

1. ✅ **DECIDED (Ray, 2026-10-01) — two PRs, §A first.** This PR is §A only. §B is filed as a follow-up
   row and is **sequenced after** the seed rename in question 4, which deletes work from it.
2. **The exact 2–3 sentences**, within the pinned structure and the no-repo-state-claims rule. Drafted
   in implementation, approved on the PR.
3. ✅ **DECIDED — new tab**: `target="_blank" rel="noopener noreferrer"`, so the portfolio page
   survives the click.
4. ✅ **DECIDED (Ray, 2026-10-01) — yes, rename the seed fixtures, as its own small OSS-1 PR.** The
   kids' real first names are already published in `packages/db/src/seed.ts:118-122`,
   `e2e/global.setup.ts:32,39` and `e2e/steps.ts:25`, so §B's screenshot rename was guarding a door
   already open. Renaming the seed closes the actual exposure and makes **every** capture safe by
   construction. **Consequence for §B: it drops the rename step, the `LANDING_FIXTURE_NAMES` allowlist
   and the throw-on-mismatch guard entirely** — the fixture names simply are neutral. §B keeps the
   pre-`git add` checklist (the date line and any stray number still need a human look).

## Review-response log (adversarial panel)

Round 1 ran eight lenses in parallel against the first draft: `correctness-reviewer`,
`scope-reviewer`, `architecture-reviewer`, `reuse-reviewer`, `security-reviewer`, and `ux-reviewer`
three times (interaction/first-run · a11y+360px · trust).

### Engineering panel (round 1)

| #   | Lens                                                         | Critique (short)                                                                                                                                                                                           | Verdict                                                | Resolution                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Correctness · Architecture · UX-2 (all three, independently) | The hero image is unreachable: `next/image`'s internal fetch re-enters the proxy with no cookie → 400 for everyone; OG crawlers fetch the raw path → 307                                                   | **accepted — verified by probe**                       | **The draft's central `next/image` argument was wrong.** Measured on a prod build: raw asset 307 un-gated, optimizer **400 with _and_ without a valid cookie**. Fix also verified: exempting the path returns 200 both ways. §B now adds `LANDING_IMAGE_PATH` to `PUBLIC_PATHS`, `metadataBase`, and asserts raw-200 + `naturalWidth > 0`.    |
| C2  | Correctness · Scope · UX-2 (all three)                       | "The landing passes the 44px tap-target measurement" cannot fail — `INTERACTIVE` excludes `<a>`, and `Button asChild` adds no `role="button"`                                                              | **accepted**                                           | Acceptance reworded to demand an assertion that _can_ fail; CTAs measured via `getByRole('main').getByRole('link')` with a `count > 0` guard, following the existing link-card test.                                                                                                                                                          |
| C3  | Correctness · Scope · Reuse · Architecture · UX-2 (all five) | Five to six live `'/'` references missing from the file list; each passes **by accident** via the new proxy redirect                                                                                       | **accepted**                                           | All converted to `APP_HOME_PATH`: `p/[profileId]/page.tsx:131`, `log-bodyweight.spec.ts:24,60,89`, `a11y.spec.ts:470`, both script defaults. Also corrected the plan's own asymmetry claim, which these omissions falsified.                                                                                                                  |
| C4  | Correctness · Reuse · Architecture                           | `safeInternalPath`'s `'/'` fallback now means "the public landing", so every login double-hops through it                                                                                                  | **accepted, with the architecture lens's shape**       | Resolved **at the call site** in `gate/actions.ts`, not by changing `safeInternalPath` — it is the hostile-input sink hardened in SEC-4 (#203) and its `'/'` return must stay safe. Correctness proposed changing the helper; declined for that reason.                                                                                       |
| C5  | Correctness · Scope · Reuse (all three)                      | `isPublicPath`'s prefix arm is dead code; the DUALS-1 lesson it claims to encode is asserted by nothing                                                                                                    | **accepted — scope's version**                         | Shipped as **exact membership**, prefix arm deleted, segment lesson kept as prose. Correctness preferred making the list injectable to test the arm; declined as an abstraction before its second use. With `LANDING_IMAGE_PATH` in §B the negatives become genuinely non-tautological (`/landing-today.pngx` is rejected by exact matching). |
| C6  | Correctness                                                  | Moving `/` to the exempt side converts SEC-1 from a universal property into a hand-maintained allowlist; the new landing case can't fail on what it names                                                  | **accepted**                                           | Gated prefetch loop widened to four routes (incl. `/routine` and `/export`); a contract test pins `PUBLIC_PATHS` as exactly `['/']`; leak markers hoisted to `APP_CONTENT_MARKERS` built from existing copy constants.                                                                                                                        |
| C7  | Correctness · Architecture                                   | No `metadataBase`, so the OG image URL is relative and most scrapers won't resolve it                                                                                                                      | **accepted**                                           | `metadataBase: new URL(SITE_URL)` in §B. Took a `lib/constants.ts` value rather than the suggested validated-env var — env wiring is a larger change and the canonical OG domain is stable.                                                                                                                                                   |
| C8  | Correctness · Reuse · UX-2                                   | The `test.use` precedent is miscited — `gate-prefetch.spec.ts` builds contexts by hand                                                                                                                     | **accepted**                                           | Both shapes stated, with which assertions use which, plus the `bypassCSP` requirement for axe.                                                                                                                                                                                                                                                |
| S2  | Scope · Reuse                                                | `PUBLIC_PATHS` array is an abstraction before its second use                                                                                                                                               | **accepted**                                           | Folded into C5.                                                                                                                                                                                                                                                                                                                               |
| S3  | Scope                                                        | The profile rename should be unconditional in `runEphemeral`, not a new `--state`                                                                                                                          | **accepted — better than the draft**                   | Unconditional, parameterized. Closes a wider hole: `publish-screenshots.ts` pushes captures to a branch on a public repo, and every seeded capture shows a real name beside a weigh-in.                                                                                                                                                       |
| S4  | Scope · UX-1 · UX-2                                          | `capture.ts` hardcodes `fullPage: true` → the asset is ~780×several-thousand px; wrong artifact for a hero and for an OG card                                                                              | **accepted**                                           | `fullPage` opt-out; intrinsic dimensions pinned in the PR description; aspect clamp on the page.                                                                                                                                                                                                                                              |
| S6  | Scope · Reuse · Architecture                                 | `screenshot-ephemeral.ts:787`'s `/p` shorthand now shadows the real route, and `SKILL.md` documents it                                                                                                     | **accepted**                                           | Shorthand retired; `SKILL.md` updated (`pnpm skills:check` would otherwise fail); script defaults → `APP_HOME_PATH`.                                                                                                                                                                                                                          |
| S7  | Scope · UX-1 · UX-3 · Correctness (all four)                 | Cut the three "what's interesting here" links                                                                                                                                                              | **accepted**                                           | Replaced with **one** link to the README's existing `#whats-interesting-here` section. UX-1's alternative; UX-3 independently showed one of the three advertised **unbuilt** work (AI-1) as though shipped.                                                                                                                                   |
| S8  | Scope                                                        | ~2h budget is roughly half the real cost                                                                                                                                                                   | **accepted**                                           | Split into §A (the route) and §B (the image), with §B recommended as a follow-up. Open question 1.                                                                                                                                                                                                                                            |
| A2  | Architecture · Reuse                                         | `APP_HOME_PATH` belongs in `lib/constants.ts` — `access-gate.ts` is the module AUTH-1 deletes                                                                                                              | **accepted**                                           | Moved. `PUBLIC_PATHS`/`isPublicPath` stay in `access-gate.ts` (they are gate policy), with a note that AUTH-1 inherits them.                                                                                                                                                                                                                  |
| A3  | Architecture                                                 | The draft never cites HH-1, the made decision that owns `/`; `APP_HOME_PATH` only survives the session-scoping branch                                                                                      | **accepted**                                           | New subsection: the route is correct under both branches, but under path-addressing the proxy rule must be **deleted**, not extended — else the proxy starts resolving households, which is the CVE-2025-29927 mistake by the back door. Recorded in the constant's docblock.                                                                 |
| A5  | Architecture                                                 | `app/loading.tsx` is a picker-shaped skeleton that would front the public landing                                                                                                                          | **accepted**                                           | Moved to `app/p/loading.tsx` in the same PR as the picker — it is the same move.                                                                                                                                                                                                                                                              |
| A7  | Architecture                                                 | OSS-1's committed audit says "no screenshots, 0 tracked files"; §B makes that false                                                                                                                        | **accepted**                                           | Amended in §B's file list. OSS-1 is the document Ray re-reads before deciding anything about published PII, and it has been flagged stale once already.                                                                                                                                                                                       |
| R5  | Reuse                                                        | The picker heading is re-typed in three places; the plan added a fourth                                                                                                                                    | **accepted**                                           | `PICKER_COPY` in `lib/constants.ts`, read by the page and all three specs. Also retires the lossy `/Who.s logging today/` regex for the curly apostrophe.                                                                                                                                                                                     |
| R6  | Reuse                                                        | The landing re-types `/gate` and the repo URL, both of which already exist                                                                                                                                 | **accepted**                                           | `GATE_PATH` imported; `GITHUB_REPO_URL` added to `lib/constants.ts` and read by the page and its spec.                                                                                                                                                                                                                                        |
| R7a | Reuse                                                        | Page-level title/description duplicates `layout.tsx`                                                                                                                                                       | **accepted**                                           | §B overrides `openGraph` only; title/description inherit.                                                                                                                                                                                                                                                                                     |
| —   | Reuse                                                        | Extract `PAGE_SHELL` (7th copy of the shell class string)                                                                                                                                                  | **rejected**                                           | Real and pre-existing — six copies exist today. A six-file refactor does not belong in a routing PR. Out-of-scope, filed.                                                                                                                                                                                                                     |
| —   | Reuse · Scope                                                | Delete `public/*.svg` and `apps/web/README.md` boilerplate                                                                                                                                                 | **rejected**                                           | Dropped from the draft instead: unrelated scope in a PR already touching routing, gate-adjacent code and the e2e harness.                                                                                                                                                                                                                     |
| —   | Architecture                                                 | Fold `export/route.ts:35`'s inline cookie check into `hasGateAccess()`                                                                                                                                     | **rejected**                                           | Genuine duplication (V1-13b), but changing a Route Handler's auth path inside a landing-page PR is the wrong PR. Out-of-scope, filed.                                                                                                                                                                                                         |
| —   | Architecture                                                 | The rename belongs in `packages/db`                                                                                                                                                                        | **rejected for now**                                   | Kept in the screenshot script, parameterized, with a pointer to OPS-2's `seedReference`/`seedFixtures` split as its eventual home. Moving it now couples this PR to an unstarted ops row.                                                                                                                                                     |
| X1  | Security                                                     | A public `/` is also an unauthenticated **Server Action POST** endpoint — the action module map is global, not page-scoped, and unknown ids are forwarded                                                  | **accepted**                                           | New §"The landing is also a public POST endpoint", a Risks row, an un-gated `Next-Action` POST test, and an invariant that the landing's graph (root layout included) imports no action module. The draft treated `/` purely as a render.                                                                                                     |
| X2  | Security                                                     | Nothing ties `PUBLIC_PATHS` to "pages that may skip `requireGatedPage()`" — OSS-2 creates the first exception and guards it with prose                                                                     | **accepted**                                           | New `pages-are-gated.test.ts` globs every `app/**/page.tsx`. This is the test that would have caught DUALS-1's #153 merge accident.                                                                                                                                                                                                           |
| X3  | Security                                                     | The screenshot mitigation is review-time and unverifiable; on a public repo the irreversible event is the **push**, not the merge; and CI treats `*.png` as inert so a later image-only PR skips the smoke | **accepted, all four parts**                           | Seeder **throws** unless every profile name is in a committed allowlist; the capture asserts the rendered `<h1>`; the script writes to the final path so provenance is the command, not a human `cp`; `ci.yml`'s inert allowlist stops covering `apps/web/public/`.                                                                           |
| X4  | Security                                                     | `images.localPatterns` is undefined, so `hasLocalMatch` returns true for **every** local path — an un-gated optimizer would serve any `public/` file                                                       | **accepted**                                           | Asset moved to `public/landing/`, `/landing/` becomes a **prefix** `PUBLIC_PATHS` entry, and `localPatterns` is scoped to `/landing/**`. This also resolves C5 better than deletion did: the segment arm now has a live positive case and a real `/landingsecret` negative.                                                                   |
| X5  | Security                                                     | `metadataBase` unset resolves OG URLs against `VERCEL_URL`/localhost; and `/gate` gets indexed, dropping a DUALS-1 precedent                                                                               | **accepted**                                           | `SITE_ORIGIN` const + `metadataBase`; `robots: { index: false, follow: false }` on `/gate`, noted as restoring DUALS-1's `X-Robots-Tag`, not inventing a rule.                                                                                                                                                                                |
| X6  | Security                                                     | `/` becomes an unauthenticated, uncacheable, unmetered dynamic render and the plan doesn't say so                                                                                                          | **accepted (option a)**                                | Explicitly accepted in Risks with the reasoning, and the static-plus-public-CSP alternative recorded as the deferred option rather than left unsaid.                                                                                                                                                                                          |
| X7  | Security (**outside the diff**)                              | The gate matcher's lookahead is unanchored: `/apiary`, `/apifoo`, `/favicon.icon`, `/_next/imagex` skip the proxy entirely — the exact `startsWith` error DUALS-1's lesson warns about                     | **accepted — verified**                                | Measured; all four skip. Fixed here despite being pre-existing: it would be incoherent to write the segment-exact lesson into `isPublicPath` while leaving the same bug three lines away. One character class, four pinned negatives. `docs/tech-debt.md` describes this exclusion as segment-scoped, which it is not.                        |
| X8  | Security (**outside the diff**)                              | The kids' real first names are **already published** in `seed.ts`, `global.setup.ts` and `steps.ts`, so §B's rename guards an already-open door                                                            | **accepted — and it corrects the plan's own argument** | §B now says so plainly instead of implying the names are private, notes that bodyweight is already safe by construction (committed fixture constants), and raises the cheaper complete fix — renaming the seed fixtures — as open question 4, filed to OSS-1.                                                                                 |

### UX panel (round 1)

| #   | Lens                       | Critique (short)                                                                                                                                                                                  | Verdict                                   | Resolution                                                                                                                                                                                                                                                                                         |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Interaction · a11y · Scope | The screenshot pushes both CTAs ~1–2 screens below the fold on a 390×844 phone; the plan's width table never does the vertical math                                                               | **accepted**                              | Buttons above the image; the asset is viewport-cropped and aspect-clamped; a `toBeInViewport()` assertion on both CTAs at 390×844 and 360×780.                                                                                                                                                     |
| U2  | Interaction · Trust (both) | "Enter access code" is the wrong primary CTA — it belongs to the ~1% who have a code, and `/gate` is a dead end with no way back                                                                  | **accepted**                              | Source link primary; gate secondary and relabelled "Household sign-in" so a stranger self-selects out; the explanation moved above the buttons; a back link added to `/gate` (one line, and precisely "what the landing's CTA needs"); `?from=${APP_HOME_PATH}` so the post-login hop is explicit. |
| U3  | Trust                      | The "don't inherit three stale claims" blocklist has a hole — README ¶3's "currently behind an access gate while v1 finishes" is itself stale, and is the sentence an implementer would reach for | **accepted — better mechanism**           | Blocklist replaced with a checkable property: **no claim whose truth depends on repo state**. A reviewer can verify that; three avoided sentences they cannot.                                                                                                                                     |
| U4  | Trust                      | "It replaces the trainer I was paying" reads as a working-product claim standing alone, with V1-30/V1-27 open as P0s one click away                                                               | **accepted**                              | Past tense — "I built it to replace…". Permanently true, costs nothing.                                                                                                                                                                                                                            |
| U5  | Trust                      | No security adjective is safe: the gate's own public file calls itself "not an authorization boundary"                                                                                            | **accepted**                              | Explicit prohibition in §Copy, with the gate explained as a _reason_ rather than a reassurance.                                                                                                                                                                                                    |
| U6  | Trust                      | The screenshot is fabricated data presented as a real app, and it is also the OG image, so a `<figcaption>` doesn't travel                                                                        | **accepted**                              | "Sample data" labelling in **both** the caption and `openGraph.description`; names pinned as `Athlete A`/`B` (not another plausible first name); "eyeball the PNG" replaced by a named five-item checklist run **before `git add`**.                                                               |
| U7  | Trust                      | `/gate` is crawlable, so a password prompt can become the public search result for "mat-plan"                                                                                                     | **accepted**                              | `robots: { index: false }` on `/gate`. One line, and it does not open the deferred SEO scope.                                                                                                                                                                                                      |
| U8  | a11y                       | `alt` appears nowhere in the plan, and axe cannot judge alt quality                                                                                                                               | **accepted**                              | The exact alt string is specified in §B, describing what the screen _does_.                                                                                                                                                                                                                        |
| U9  | a11y                       | No `sizes`; the LCP image defaults to `lazy`; and `priority` is **deprecated in Next 16**                                                                                                         | **accepted**                              | All four props named in §B: `sizes`, `loading="eager"`, `fetchPriority="high"`, and explicitly **not** `priority`.                                                                                                                                                                                 |
| U10 | a11y                       | `sm:flex-row` is the design's only row, is unmeasured, and `shrink-0` + `whitespace-nowrap` make a copy edit overflow rather than wrap                                                            | **accepted — the lens's own alternative** | `sm:flex-row` deleted. The draft called it "never load-bearing", so removing it costs nothing and deletes the whole overflow class.                                                                                                                                                                |
| U11 | a11y                       | The plan overclaims that it closes the "no un-gated page has ever been axe-scanned" gap — `/gate` stays unscanned, and this PR promotes it to screen two                                          | **accepted**                              | `/gate` added to the storage-state-free a11y block.                                                                                                                                                                                                                                                |
| U12 | Interaction                | `max-w-md` is narrower than every other screen and reads as unfinished on a laptop                                                                                                                | **accepted**                              | `max-w-2xl` (matching every other screen) with `max-w-prose` capping the text measure.                                                                                                                                                                                                             |
| U13 | Interaction                | The plan promises an alternatives weighing it never contains ("were weighed (below)")                                                                                                             | **accepted**                              | Alt A / Alt B / Alt C written out, each with why it loses.                                                                                                                                                                                                                                         |
| U14 | Interaction                | The copy brief yields the wrong register and buries the hook in paragraph two                                                                                                                     | **accepted**                              | Four-point structure pinned, leading with the hook from `README.md:8-9`.                                                                                                                                                                                                                           |
| U15 | Interaction · a11y         | The screenshot has no caption; `<figure>`/`<figcaption>`; `<header>` wrapper; `rel="noopener noreferrer"` if `target="_blank"`                                                                    | **accepted**                              | Caption in §B (doing double duty as the sample-data label); `<header>` matching the other pages; the tab question raised as open question 3.                                                                                                                                                       |

### Decisions after the panel (Ray, 2026-10-01)

Two panel findings became decisions that reshaped the work rather than the plan:

- **§A/§B split accepted** (scope S8). This PR is §A.
- **The seed rename accepted** (security X8) as its own OSS-1 PR, **sequenced between §A and §B**. It
  **supersedes** the X3 and S3 resolutions above: §B no longer needs an unconditional rename, the
  `LANDING_FIXTURE_NAMES` allowlist or the throw-on-mismatch guard, because the fixture data stops
  containing anything private. Those rows are kept as the record of how the reasoning got here — the
  panel's answer was right about the mechanism and one step downstream of the cause.

**No blocking concern survives.** Two lens claims were settled by measurement rather than argument —
C1/X4 (the optimizer 400, and that exempting the path fixes it) and X7 (the unanchored matcher) — and
the probe commands are in §B and §A respectively so a reviewer can redo them.

Round 2 is a light re-review of this revision by the lenses that raised C1, C2, U1–U2 and X1–X3 (the
reshaping findings), after Ray decides the open questions.
