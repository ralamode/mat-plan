# AUTH-1 1d — retire the access gate

> Backlog: [plan.md](../plan.md) row `AUTH-1`. Branches: `fix/auth-1d-0-sign-in-card`
> (PR 0 — **shipped 2026-11-05, #333**), `feat/auth-1d-retire-the-gate` (PR A),
> `refactor/pages-need-a-session` (PR C).
> Parent: [auth-1-clerk-google.md](./auth-1-clerk-google.md).
> Milestone: [beta-1.md](../milestones/beta-1.md) — the one unticked step.
>
> **Hardened by sixteen adversarial lens-runs before any implementation code:** nine on the first
> draft, four re-reviews on the reconciliation, and a three-lens panel on the **lit** sign-in screen
> that discharges the pre-flight box below. They replaced both original design decisions, recovered
> two committed prerequisites the draft had missed, and found a production-visible layout defect that
> nothing in CI can see. See § Review-response log.

## Goal

Delete the shared access code and everything that reads it, so the boundary is **a session with a
membership** and nothing else. `1c-4` made `getHouseholdScope()` resolve the signed-in principal's
`household_members` row — the obligation this chunk was blocked on, because before it, deleting the
gate would have _widened_ access.

This is the **point of no easy return**. `ACCESS_GATE_PASSWORD` leaves `lib/env.ts`, which validates
at import, so a revert does not boot until the secret is restored.

## Pre-flight

| #   | Check                                                                                  | Status                                          |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Production sign-in works end-to-end                                                    | ✅ 2026-11-04                                   |
| 2   | A signed-in principal resolves to the household (state **A**)                          | ✅ the picker renders                           |
| 3   | `0019` live in production                                                              | ✅ no `scope_outcome: schema_missing` in Sentry |
| 4   | Production's enabled sign-in strategies, read on the **production** instance           | ✅ 2026-11-04 — see below                       |
| 5   | The **lit** sign-in screen's three-lens UX panel (`runbooks.md:1616-1622`)             | ✅ **discharged** — § The lit panel             |
| 6   | A principal with **no membership** resolves to state C and renders `NO_HOUSEHOLD_COPY` | ✅ verified in production 2026-11-04            |
| 7   | `/__clerk/*` is served by **our** proxy, not Clerk's auto-proxy relay                  | ✅ 2026-11-04 — see below                       |

**Row 4 — the command, the instance, and the fields**, because the failure this row exists to prevent
is _reading the wrong instance_ (`runbooks.md:1443-1448`: the 2026-10-21 verification ran against the
**development** instance while production stayed `Open`, proven by two uninvited accounts
self-creating). Read 2026-11-04 from `https://clerk.mat-plan.dev/v1/environment`, the FAPI host the
production `pk_live_` key decodes to:

```
user_settings.sign_up.mode        restricted      (Invite-only)
auth_config.identification_*      ['oauth_google']  (one door)
user_settings.sign_up.captcha_enabled   false
protect_config.loaders            present         ← a SEPARATE switch; see § Out-of-scope
```

🔴 **`sign_up.mode` governs account CREATION, not authentication.** The field is namespaced under
`sign_up`. An account that already exists signs in normally and obtains a valid session with **no
membership** — state C, row 6, demonstrated in production. Invite-only bounds who can _become_ a
principal from now on; it says nothing about the set of existing ones, and `runbooks.md:1443-1446`
records that this instance spent a window in `Open`. **Row 6's measurement is two numbers:** the Clerk
Users count against live `household_members` rows, dated.

**Row 7 — the Clerk auto-proxy relay.** `@clerk/nextjs@7.9.19 → clerkMiddleware.js:60-75` arms a
frontend-API proxy at `/__clerk/*` when the key is `pk_live_`, no explicit `domain`/`proxyUrl` is set,
`CLERK_DISABLE_AUTO_PROXY` is unset, and the request hostname ends `.vercel.app`
(`@clerk/shared@4.41.0 → proxy.mjs:33-36`). It `return`s **before our handler**, so our limiters and
our CSP never run; `@clerk/backend@3.26.1 → proxy.mjs:88` reads caller-supplied `cf-connecting-ip`
first, and `:189` appends FAPI's `Set-Cookie` verbatim. **Probed 2026-11-04:**
`https://www.mat-plan.dev/__clerk/v1/client` returns 307 **carrying our CSP header**, which only
`withSecurityHeaders` sets — so our proxy served it and the relay is **not armed** on the custom
domain, as expected. The alias in the repo 404s. ⚠️ The residual is any _other_ `*.vercel.app` alias
serving this deployment, which no gate here can observe. **PR A disarms it explicitly** —
`frontendApiProxy: { enabled: false }` at `proxy.ts:147` — pinned in `proxy.test.ts` and added to the
`@clerk/nextjs`-bump re-verify obligation. Free, and it does not depend on a hostname staying off a list.

⚠️ **`captcha_enabled: false` is a finding, not a field.** It answers the unticked box at
`runbooks.md:1625-1627` in the negative, and `runbooks.md:1609-1614` already says that in that case
`CLERK_BOT_PROTECTION_ORIGIN` (`lib/clerk.ts:112`) and its `frame-src` entry (`proxy.ts:82`) are dead
CSP sources "not left to look like working protection." PR A removes them with the dated reason.

## The lit panel — what running it found

`runbooks.md:1616-1622` required this before `1d` and it had never run, because every harness blanks
the Clerk keys (`e2e-local.ts:130-131`, `screenshot-ephemeral.ts:1005-1006`) so all CI evidence is of
the **dark** state. Run 2026-11-04 against the **development** instance via `pnpm dev`; captures at
`.screenshots/sign-in-lit-{360,390,820,1280}.png`.

⚠️ **Label these captures "development instance" in the PR body.** They carry Clerk's "Development
mode" badge, which production never renders, and the invite-only refusal appears in none of them.

**Verified holding** (each was previously an assumption `tech-debt.md:54-58` says nothing pins):

| Fact                                           | Measured                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `appearance.elements` + `cssLayerName` cascade | Clerk's `<h1>` is `display:none` via `cl-headerTitle hidden` → the a11y tree has **exactly one** `<h1>`                    |
| The 44px lever lands on vendor DOM             | "Continue with Google" = **44.0px**, `min-height: 44px` computed, `min-h-11` present                                       |
| 360px                                          | `scrollWidth === 360`; no horizontal overflow                                                                              |
| Keyboard                                       | tab order privacy → Google → Clerk badge → access code → footer ×2; `:focus-visible` matches, 3px ring in a visible colour |

**Found, and new:**

1. 🔴 **The Clerk card overhangs its column by 48px.** At 1280: the page column is 352px
   (`max-w-sm` + `px-4`), the card is a fixed `width: 400px` — x 464→**864** against the heading's
   464→816. The one action on the screen sits proudly outside the column. No document overflow, so
   `expectNoHorizontalOverflow` can never see it, and the harness only renders the dark state anyway.
   **Fix:** `rootBox: 'w-full'`, `cardBox: 'w-full'` in `appearance.elements` (class strings, so the
   CSP constraint at `page.tsx:77-84` is satisfied). **Not** widening `main` — that leaves a 16px
   misalignment pointing the other way.
2. **Clerk's attribution link is 48×14**, `target="_blank"`, `href=go.clerk.com`. Under this repo's
   44px bar _and_ WCAG 2.2 SC 2.5.8 (24×24) — a genuine failure, attributable to the vendor, with no
   `elements` key to reach it and brand-hiding behind a paid tier. **Disposition:** record the dated
   measurement on the **existing** floating-major `tech-debt.md` row (not a new one) so the next bump
   re-verifies it; if any helper is pointed at the lit card, exclude the Clerk root **by selector**.
   🔴 Do not lower `MIN_TAP_TARGET_PX` and do not add a per-node allowlist — `a11y.spec.ts:172-173`
   makes "no allowlist" an explicit principle.
3. **Hiding `headerTitle`/`headerSubtitle` leaves the header container**, so the card opens with ~35px
   of empty bordered box — the visual signature of a half-rendered component, on the one screen whose
   documented failure mode is "did it load?". **Fix:** `header: 'hidden'`, same map.
4. 🔴 **The lit card has never been rendered in dark theme.** `theme-provider.tsx:54-55` is
   `defaultTheme="system" enableSystem`, so a phone at night gets dark with no user action — and
   `a11y.spec.ts`'s dark describe loops `ROUTES` only, which excludes every public route. `design.md:81`
   claims _"Both themes are scanned by `e2e/a11y.spec.ts` on every route"_, which is **false** and has
   been since `12e8fc9` (UI-4). Pre-existing, but `1d` makes `/sign-in` the only door and the lit card
   ships its own palette. **PR A corrects `design.md:81` and captures the dark lit card**; wiring
   Clerk `variables` to our tokens is deferred (⚠️ it may inject a runtime `<style>`, which the nonce'd
   `style-src` drops silently — the exact trap `page.tsx:77-84` documents).
5. **The refusal path is unobserved — and there are TWO destinations the draft conflated.**
   (a) an address with **no Clerk account** → refused at the **sign-up** step, destination possibly
   off-origin; (b) an **existing** principal with no membership → **signs in** and lands on `/p`'s
   `NO_HOUSEHOLD_COPY`, on our origin, disclosing nothing. (b) is pre-flight row 6 and is now verified.
   The probe below must hit **(a)** — a Google address that has never touched this instance — or it
   will measure (b) and wrongly report the refusal path as fine. Note neither of the maintainer's two
   accounts can test it; both already exist. `layout.tsx:81-96` sets `signInUrl` and the redirect URLs but
   **not `signUpUrl`**, and no `<SignUp/>` exists. Clerk's documented refusal copy is a property of
   `<SignUp/>`, so a refused account's destination is probably Clerk's Account Portal on another
   origin — no footer, no `/privacy`, no way back. **Owed before merge:** one run on the **production**
   instance with an uninvited address, recording the final URL's origin, the verbatim message, and
   whether any link returns to a mat-plan origin. If off-origin, set `signUpUrl={SIGN_IN_PATH}`.

## Open question 1 — RESOLVED by the lit panel

The draft asked what replaces the sign-in screen's only forward control. **Its premise was false.**
`SiteFooter` is in the root layout (`layout.tsx:103-114`) and renders `/` and `/privacy` on every
route — visible in all four captures. A reader stranded by a failed Clerk bundle was never stranded;
`page.tsx:46-51` asserts otherwise and is wrong (the `a11y.spec.ts:846` pin counts `<main>` only,
which is what made the button look like the sole exit).

**Decision — promote, don't add:**

- Move the `PRIVACY_PATH` link (`page.tsx:71-73`) **out** of the `configured` ternary so it renders in
  both states, and delete the access-code button. Nothing new is introduced.
- The **dark** state is then `<h1>` + `notYet` + the privacy link, and the footer is its named exit.
  Rewrite `page.tsx:43-51` to say so — a recorded decision, not a silent deletion.
- Add one `SIGN_IN_COPY` string stating the precondition, rendered in the **lit** branch above the
  Clerk mount, in `text-foreground` (`constants.ts:598-600` already sets that rule for copy "read once,
  cold, immediately before an act with no undo"):

  ```ts
  invitation:
    'Signing in needs an address this household has invited, and Google’s consent screen appears
     before that is checked.',
  ```

  It names the **sequencing**, which is what makes it actionable: a stranger can stop before
  disclosing. 🔴 **The draft's wording promised the invitation was sufficient, and it is not.** An
  invitation gets a Clerk account; a `household_members` row is what gets you a household, and nothing
  under `apps/web` writes one. So an **invited** parent signing in before that row exists lands on
  `NO_HOUSEHOLD_COPY` (`household.ts:172` names exactly this case). The copy must not claim a
  precondition the endpoint does not honour — the UI-never-looser-than-the-endpoint rule, in copy form.
  Its docblock names `NO_HOUSEHOLD_COPY.wrongAccount`/`next` and says which mechanism each describes
  (Clerk sign-up mode vs membership row), because after `1d` "invitation" otherwise means two different
  gates on two screens with nothing linking them. Statement of fact, no imperative, no "yet" (an uninvited account is never linked).
  ⚠️ **No contact address on this page** — `notice.md:262` carries one and this page is public and
  indexed; the footer reaches it in two taps. Record that reason, or the next author reads the absence
  as an oversight.

- `LANDING_COPY.gateCta` → `signInCta`, pointing at `SIGN_IN_PATH`. `a11y.spec.ts:784`'s pin of **2**
  landing links is unchanged.

## Acceptance

The parent plan's criterion 5 is **amended and split**, because as written it cannot pass and it
measures names rather than the property.

**PR A** — `git grep -n 'mp_gate' -- apps packages .github` returns only `proxy.ts`'s tombstone and
the `proxy.test.ts` cases that pin it. (AGENTS.md § Constants _requires_ the literal on a contract
test's assertion side, so those cannot be written around.)

**PR A, symbols** — `git grep -nE 'ACCESS_GATE_PASSWORD|GATE_COOKIE_NAME|hasGateAccess|gateTokenFor|gateLogin|isValidGateCookie|submitGate' -- apps packages .github .claude`
returns **nothing**. Full stop — no `except` clause, because the two fixtures
(`check-preview-isolation.test.sh:42-43`, `generate-privacy-notice.{ts:259,test.ts:129,176}`) are
_renamed_ in this PR, which is what makes it true. The earlier draft carved them out **and** told the
file table to rename them — two different end states for the same files. `apps/web/app/gate/` does not
exist.

**PR A, the published documents** — the clause the draft had no command for at all:

```sh
git grep -niE 'access code|access-code|mp_gate|un-gated' -- docs/privacy .github/SECURITY.md apps/web/app/privacy apps/web/lib/privacy
```

returns only the dated "what changed" sections. (Today: 28 hits in 6 files.) ⚠️ `privacy:generate`
cannot stand in for this — it only proves `notice.md` ↔ `notice-content.ts` agree byte-exactly, never
that the notice stopped describing an access code.

🔴 **Every `mp_gate` and `ACCESS_GATE_PASSWORD` site is PR A work.** The draft assigned the whole
criterion to a later PR, which would have shipped the one-way door with no acceptance clause for its
own behaviour.

**Done when** — tagged, so a PR description cannot claim the other's work:

- (A) `app/gate/`, `lib/access-gate.ts`, `lib/dal/gate.ts` and their tests do not exist.
- (A) Every page and Route Handler enforces a session only; no code path reads `mp_gate`.
- (A) A browser holding `mp_gate` has it deleted on the next **matched** response (`proxy.ts:269`
  excludes `_next/static/`, `_next/image`, `favicon.ico` — not "every path").
- (A) SEC-1's regression is pinned by the matcher-shape guard.
- (A) `/privacy` and `data-inventory.md` no longer describe an access code; `privacy:generate` leaves a
  clean tree.
- (B) `lib/env.ts` carries no `ACCESS_GATE_PASSWORD`; the app boots without it.
- (A, B) `pnpm verify`, `pnpm e2e:local`, `bash .claude/skills/hold-the-bar/check.sh` green.

## Scope, the split, and merge order

~1,400 changed lines across ~70 files against a <400 target. The docs cannot be what splits off —
`guides:check`, the byte-exact notice generator and `status:check` are hard gates binding them to the
PR that changes the behaviour. So the seam is in the code, at **"enforces the gate" vs "supplies the
secret"**:

- **PR 0 — the lit-screen fixes. ✅ SHIPPED 2026-11-05 as #333**, and it is the one part of this plan
  the implementation contradicted, so the prediction is kept here rather than quietly overwritten.
  **Planned:** `rootBox`/`cardBox: 'w-full'` for the 48px overhang, plus `header: 'hidden'`.
  **Shipped:** neither. Clerk's card is **not restyled at all** — `SIGN_IN_APPEARANCE` carries exactly
  one key (`socialButtonsBlockButton: 'min-h-11'`, because the vendor's button measures 32px against a
  44px bar) and the **page** is sized to the card instead (`max-w-[432px]` against its natural 400px).
  Removing the "Secured by Clerk" mark is paid-tier, so styling around a mark that stays buys a
  half-integrated component every CDN build can break.
  🔴 **And the real cause was deeper than a width.** `globals.css` had declared a bare `@layer clerk;`
  since `1a`, which made it the **lowest** layer — so Tailwind's preflight (`margin/padding/border: 0`
  on `*` inside `@layer base`) had been stripping Clerk's own spacing for three chunks. Naming all five
  in order (`theme, base, clerk, components, utilities`) fixes it in both directions, with a test probed
  RED each way. PR 0 also gave the screen its own chrome (the mark linking home, one `/privacy` link)
  and suppressed `SiteFooter` on the sign-in subtree.
  ⚠️ **Invisible to CI by construction**, which is why the plan could not predict it: every harness
  blanks the Clerk keys, so no CI run has ever rendered the lit card.
  **The split rationale held exactly as written**: `apps/web/app/sign-in/` and `apps/web/app/globals.css`
  are owned by **no** feature guide, so `guides:check` did not bind them to the boundary PR, and a live
  production defect on the only door did not wait behind an irreversible one. It ran to ~12 commits
  rather than ~80 lines.
- **PR A — the one-way door.** Everything that reads, enforces **or supplies** the gate, plus every doc
  making a claim about the boundary. Irreversible.
- **PR C — the guard rename**, after A. `pages-are-gated.test.ts` → `pages-need-a-session.test.ts`,
  `git mv` plus the citation sweep. Zero behaviour.

🔴 **The draft split A from a "reversible tail" PR B. That is dropped.** Its justification was
revert-safety, and the re-review established "revert does not boot" is **PR A's property** either way
(`lib/env.ts` is PR A's edit). B shaved ~15% off a PR that stays ~3× the target while _adding_ a second
changelog fragment, a stacked-retarget dance, a split criterion, and a window on `main` where the
secret is set in Vercel and read by nothing. Three separate lenses then found its contents
misassigned — `runbooks.md`, `ui-screenshot/SKILL.md`, `screenshot-ephemeral.ts` and `tech-debt.md` all
carry boundary claims. A seam that keeps misclassifying its own contents is not carrying its weight.
Folding the suppliers into A also removes the ordering hazard entirely: `ci.yml:365,393` →
`scripts/e2e-local.ts:106` → `e2e/login.ts` only breaks _because_ they were separate.

⚠️ **Dissent recorded:** the architecture lens re-read the A/B seam and found it sound. The deciding
evidence against it is the misassignment count, not the seam's logic.

**PR A is ~1,000 lines and knowingly exceeds the <400 target.** Saying so is the point: the two
genuinely separable concerns are PR 0 and PR C; the rest is one concern — "the gate is gone" — and
cutting it further by weight buys ordering risk rather than reviewability.

## Design 1 — the e2e entry point

`playwright.config.ts:46-75` makes `setup` a dependency of `chromium` and `a11y`;
`global.setup.ts:26` calls `gateLogin(page)`; `playwright.config.ts:42` health-checks `/gate`.

The replacement is one layer lower: the harness session is an **environment variable**
(`lib/env.ts:199` snapshots it at module scope; `lib/dal/session.ts:72` returns it first), which
`e2e/login.ts:20-31` already records as the reason `1c-3a` retracted the promised `sessionLogin`.

**Decision.** Delete `e2e/login.ts`; drop the call; repoint the health check to `/`. Keep the picker
health check and the write-path warming — both exist for non-auth reasons.
🔴 **Add `await page.goto(APP_HOME_PATH)` as the setup's first line**: `gateLogin` performs the only
`page.goto`, so without it the picker assertion runs against `about:blank`.

🔴 **`STORAGE_STATE` carries nothing, and the draft's reason for keeping it was false.**
`global.setup.ts:34` captures on the **picker**, but `TimeZoneSync` renders only at
`p/[profileId]/page.tsx:139` — `capture.ts:88-90` and `a11y.spec.ts:674` both say so. Determinism comes
from `use.timezoneId`, a browser-level setting. So after `1d` the saved state is an **empty cookie
jar**. **Decision: delete `STORAGE_STATE`, both `storageState:` wirings, and `NO_GATE_STATE` together**
— they are one coupled decision, and a named empty-jar const with no non-empty counterpart is
decoration. Do **not** rename to `NO_SESSION_STATE`: the session comes from the process env, so that
name asserts a property a cookie jar cannot have.

**Per-consumer disposition** (four files, six sites — the draft said "five specs" and dispositioned
three):

| Site                           | After `1d`                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landing.spec.ts:42-49`        | A whole test driving `GATE_PATH` → `GATE_COPY.back`. **Deleted**; its successor is gated on Open Q1's CTA decision, so it is not mechanical.                                                                                                                                                                        |
| `landing.spec.ts:51-54`        | **Inverts** — asserts `/p` → gate from a now bypass-authenticated context. Deleted.                                                                                                                                                                                                                                 |
| `landing.spec.ts:131`          | 🔴 See below.                                                                                                                                                                                                                                                                                                       |
| `privacy.spec.ts:26`, `:56-63` | Its docblock cites `isPublicPath('/privacy/') === false` as pinned in `access-gate.test.ts`, which PR A deletes — and the pin never lived there; it is `public-paths.test.ts:30`. Re-cite. `:65-70` decays to a 404 that cannot distinguish "not public" from "does not exist": retire the runtime arm and say why. |
| `a11y.spec.ts:774`             | Context no longer carries a premise; see § The lit panel for what this route asserts now.                                                                                                                                                                                                                           |

🔴 **`landing.spec.ts:131` is PRIV-2's unauthenticated-action proof, and the draft reasoned in a
circle.** Its variant 1 is protected by _the gate bounce and nothing else_ (`:95-101`: "the internal
fetch meets the proxy **without a cookie**"). After `1d` that fetch is bypass-authenticated, so the
Save action runs and the tail assertion at `:158-160` goes red. Meanwhile § Out-of-scope cites that
very property ("no unauthenticated request does DB work") to justify deleting the auth limiter. **Both
halves of the evidence vanish in the same diff.** Production stays protected by the in-action
`requireSession()` (unit-proved in `actions.test.ts`), so what is lost is the _runtime_ proof.
**Decision:** keep variant 2 (spoofed `x-action-forwarded`, whose premise survives), delete variant 1,
and fold the loss into the **same** `tech-debt.md` row as the deferred un-bypassed server so one row
names both halves of what is uncovered.

## Design 2 — SEC-1's regression: a matcher-shape pin

The draft chose a second un-bypassed Playwright `webServer`. **Three lenses killed it independently:**
it proves the dark-deployment branch (`proxy.ts:143` returns before `clerkMiddleware()` is composed
when keys are absent, which is always true in the harness); the regression it guards **fails closed**
after `1d` (re-add a `missing:` exclusion and `auth()` throws → `requireSession()` redirects → the spec
stays green); and it would break `bypass-is-contained.test.ts:50-61`, which pins the set of sources
naming `E2E_SESSION_BYPASS_USER_ID` to exactly three — Playwright's `webServer.env` can only _set_ a
key (`runner/index.js:870-876`), so the config must name it.

**Chosen: pin the matcher's shape.** SEC-1's hole was a `missing:` header condition, which _requires an
object entry_. `proxy.test.ts:407-408` already compiles the matcher with Next's `getMiddlewareMatchers`:

🔴 **Assert the COMPILED entry, not the source array.** The obvious form —
`config.matcher.every((m) => typeof m === 'string')` — is a **type-level tautology**: `config.matcher`
(`proxy.ts:245-270`) infers as `string[]`, so the predicate is unconditionally true in any tree that
typechecks, and its probe only goes red because Vitest does not typecheck. `proxy.test.ts:405-408`
already loads Next's compiler:

```ts
// SEC-1: a header-conditioned entry (`missing:`/`has:`) decides whether the proxy runs AT ALL.
const [m] = getMiddlewareMatchers(config.matcher, {});
expect(m).not.toHaveProperty('has');
expect(m).not.toHaveProperty('missing');
```

This fails on the SEC-1 mutation for the right reason and survives a Next version that compiles
conditions differently. `MatcherCompiler`'s return type widens to include the optional fields.

🔴 **The eight gated content cases are DELETED; two runtime cases survive, via a different witness.**
The draft kept the spec with a per-route table that re-asserts the premise § Design 1 destroys: under
the process-wide bypass `/p` returns **200 carrying `PICKER_COPY.heading`** and `/p/<id>/export`
returns **the export, not 404**. So "no app content on the wire" is genuinely unobservable from a
bypassed process, and those eight cases go.

**But SEC-1's property is not "no app content" — it is "a matcher condition decides whether the proxy
runs AT ALL" (`proxy.ts:249-252`), and that IS observable through the bypass.** `withSecurityHeaders`
(`proxy.ts:94-105`) is called from nowhere but `proxy()`, so the `Content-Security-Policy` response
header is a one-bit witness that the proxy ran on _this_ request:

```ts
// SEC-1 at runtime: only `withSecurityHeaders` sets this header, so its presence is the proxy's
// signature — true under the harness bypass, where a content assertion is not.
for (const h of [{ 'next-router-prefetch': '1' }, { purpose: 'prefetch' }]) {
  const res = await context.request.get(APP_HOME_PATH, { headers: h, maxRedirects: 0 });
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
}
// non-vacuity control: a matcher-excluded path carries no CSP
expect(
  (await context.request.get('/_next/static/x.js')).headers()['content-security-policy'],
).toBeUndefined();
```

The matcher pin does **not** cover this: it sees `config.matcher`'s shape only, so re-introducing the
exclusion at any other layer — an early `return` in `proxy()` keyed on the header, a `source` change —
is caught by nothing without these two tests. They move into `landing.spec.ts` with the public-`/`
cases (which are **two** tests, a loop over two headers — not "one" as the draft said).

**Option B (per-request bypass) stays rejected, with the argument corrected.** The draft rejected an
opt-_in_ header; the inverse — a header that can only make a request _anonymous_ — is fail-safe by
construction. The surviving objection is narrower: production code would contain a line reading a
request header to decide authentication, and `lib/env.ts:188-196` wants one evaluation.

## Design 3 — the `mp_gate` tombstone

**Carrier.** After the bounce goes, `proxy.ts:218` is the function's only `return`, so every return
passes through the wrapper — including Clerk's handshake redirect, which `clerkMiddleware.js:152-166`
builds and returns _without calling our handler_. Verified by two lenses.

🔴 **Mechanism: a literal header, not the cookie jar, and only when the cookie is present.**
`ResponseCookies` mutation calls `replace()` (`@edge-runtime/cookies/index.js:313-318`), which does
`headers.delete("set-cookie")` and re-emits only the parsed bag — keyed by **name alone**, round-tripped
through `decodeURIComponent`/`encodeURIComponent`. On the response that establishes a session that can
mangle `__clerk_handshake` and collapses same-name/different-`Domain` pairs. Separately, `withClerk`
does **not** always return a `NextResponse`: `clerkMiddleware.js:63-70` auto-arms a frontend-API proxy
branch when the publishable key is production and the hostname matches, returning a plain `Response`
whose `.cookies` is `undefined` — laundered past TypeScript by the cast at `proxy.ts:147-151`.

```ts
/** The gate's cookie, retired at AUTH-1 1d. Removal trigger: 2027-02-04, docs/tech-debt.md row. */
const RETIRED_GATE_COOKIE = 'mp_gate';

function withGateCookieTombstone(request: NextRequest, response: Response): Response {
  if (request.cookies.has(RETIRED_GATE_COOKIE)) {
    response.headers.append(
      'set-cookie',
      `${RETIRED_GATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
  }
  return response;
}
```

🔴 **The const comes back, and the draft's reason for dropping it was arithmetic that its own test
plan falsifies.** The draft said "the literal appears once in source, and AGENTS.md exempts single-use
literals" — but the five `proxy.test.ts` cases below each set and assert it, so it lands in ≥2 files
and ≥6 sites that must stay in sync. AGENTS.md § Constants: _"appears in ≥2 places … becomes a
`const`. The second occurrence is the trigger to extract"_, with the one sanctioned exception being a
contract test that pins the value. The amended criterion now explicitly allows a declaration plus its
pin, which **removes the obstacle the draft invented**. So: `expect(RETIRED_GATE_COOKIE).toBe('mp_gate')`,
exactly replacing the pin at `access-gate.test.ts:51-53` that PR A deletes.

**Typing and naming.** The parameter is `Response`, not `NextResponse` — Design 3 exists _because_
`withClerk` can return a plain `Response`, so typing it `NextResponse` would re-launder the cast the
section calls a lie. Request first, matching `withClerk(request, event, response)`. And the body
handles one cookie, so it is named for one rather than a plural with no list.

Probed against the installed versions: plain `Response` accepts the append; `Response.redirect()`
**throws** (immutable guard) — Clerk uses neither, but that is a vendor construction detail at a
floating dependency, which is what the handshake test exists to pin. The Fetch spec makes `Set-Cookie`
a forbidden response-header name, so the append is _specified_ to be a silent no-op — it is safe here
because **Next's own `ResponseCookies.replace()` uses `headers.append('set-cookie', …)` internally**,
so the mechanism cannot be blocked in any runtime where `response.cookies.set()` works. `Path=/` matches
`app/gate/actions.ts:73`; `git log -S` confirms `path: '/'` since V0-4, so no stale second `mp_gate` can
exist at another path and the `has()` guard cannot stick true. Omitting `Secure` is correct — cookie
identity is name/domain/path.

**Carrier naming.** A cookie mutation inside `withSecurityHeaders` is a responsibility mismatch:
`withRetiredCookies(withSecurityHeaders(await withClerk(…), csp), request)`. `withSecurityHeaders` is
`.set()`-only, so nesting order is free.

**No `RETIRED_COOKIES` const.** After the `sentry-scrub.ts` rewrite the literal appears once in source,
and AGENTS.md exempts single-use literals. The draft's stated reason — that the acceptance grep forbade
`RETIRED_GATE_COOKIE_NAME` — was the wrong reason to record: it teaches the next chunk to shape code
around a doc. The criterion is amended instead.

**Tests — five cases, and the fifth is the one that makes the other four mean anything:**

1. pass-through return (`NextResponse.next()`);
2. Clerk handshake return (`NextResponse.redirect`) — this is the case that fails loudly if a Clerk
   bump switches to `Response.redirect`, whose headers are **immutable** (probed: `append` throws);
3. a **plain `Response`** return — the auto-proxy branch, where the cast is a lie;
4. byte-identity of a Clerk cookie containing `+`, `/`, `=`. ⚠️ Label this honestly: under
   `headers.append` it cannot fail, because nothing parses an existing header. It is a
   **mechanism-choice tripwire** — probe it by reverting to `response.cookies.delete`, which is when it
   goes red;
5. 🔴 **the negative case.** A request with **no** `mp_gate` gets no `mp_gate` `Set-Cookie`. Without it,
   deleting the `has()` guard leaves all four green while every visitor receives a spurious
   `Set-Cookie` on every matched response — and that guard is the whole subject of the residual below.

⚠️ **Count ours, never theirs.** Clerk builds the handshake with `requestState.headers.forEach(…)`, and
`Headers.forEach` combines multi-value headers, so a total count is vendor-shaped. But
`getSetCookie()` returns the uncombined array, so
`getSetCookie().filter((c) => c.startsWith('mp_gate='))` is assertable — and that count is what catches
a double-append if the wrapper is ever nested twice.

**All five go in the probe-RED list.** They are new blocks, so the "union of the § Design 4 commands'
hits" scoping would have excluded them.

**Residual, benign, worth writing down:** any caller can send `Cookie: mp_gate=x` and force a
`Set-Cookie` onto any matched response. It discloses nothing, both arms of ADR 0006's byte-identical
refusal carry the same header, and a cached copy would serve a harmless deletion — but it makes an
otherwise-cacheable public response uncacheable for that request, which belongs beside the
"kept off the handshake path" claim.

## Design 4 — enumeration policy

The draft's lists went stale against the tree three times, and replacing _"all 19 sites"_ with
_"the grep returns 31 files"_ repeated the error one section after documenting it. **Every enumeration
in this plan is a command plus a policy, never a count and never a hand list.**

```sh
# 1. symbols — note gateLogin/e2e-login/submitGate, which the draft's command omitted, and `.claude`
git grep -nE 'ACCESS_GATE_PASSWORD|GATE_COOKIE_NAME|hasGateAccess|gateTokenFor|GATE_PATH|GATE_COPY|isUngatedPath|gateLogin|isValidGateCookie|submitGate|e2e/login' -- apps packages .github .claude docs/features
# 2. the cookie
git grep -n 'mp_gate' -- apps packages .github .claude docs/features
# 3. PROSE — the claims with no symbol, which is where the dangerous residue lives
git grep -nEi 'access (code|gate)|access-gate|\bthe gate\b|un-?gated|gate[- ](code|holder)|shared (code|secret|password)' -- apps packages .github .claude docs ':!docs/plans/' ':!docs/changelog' ':!docs/decisions'
# 4. the published documents (acceptance clause)
git grep -niE 'access code|access-code|mp_gate|un-gated' -- docs/privacy .github/SECURITY.md apps/web/app/privacy apps/web/lib/privacy
# 5. the guard's old name — PR C
git grep -l 'pages-are-gated'
```

**Policy, in three parts — the draft had only the first and it leaked twice:**

1. **Who is updated:** code, config, **`.claude/skills/**` and `.claude/agents/**`**, and owned feature
   guides. **Dated history is not** — merged plans, changelog fragments, ADRs, and `notice.md`'s dated
   "what changed" sections. ⚠️ `docs/plans/ai-1-nl-logging.md` is **not** history: `write-path.md:504-506`
   marks it as a live design doc resting on the gate limiter, so it is updated.
2. **The default action is DELETION, and that is wrong for a whole class.** A hit whose right action is
   a **replacement** earns its own row: `isUngatedPath → isPublicPath` (a substitution —
   `isUngatedPath` is `GATE_PATH ∪ isPublicPath`, so deleting it breaks the suite's only non-vacuity
   escape), `actions.ts:63`'s `headers`-into-Sentry reason (survives; its subject becomes Clerk's
   session cookie, which is _stronger_), `COOKIE_MAX_AGE`'s antecedent, and `site-footer.tsx:11`'s
   `GATE_COPY.back` precedent, which § Open Q1 makes load-bearing for the new "the footer is the exit"
   argument.
3. **Command 3 exists because commands 1-2 are symbol-shaped and the surviving claims are prose.**
   `tech-debt.md:108-112` already records this exact lesson — _"a literal single-phrase `git grep`
   cannot police text Prettier reflows… the gate that works is phrasing-tolerant"_. The draft
   documented the staleness lesson and then repeated the mechanism that caused it.
   ⚠️ `git grep -l '1d'` returns **zero** hits in `notice.md`, so the published document is invisible
   to a chunk-id sweep. Command 4 is the only thing that sees it.

⚠️ `git grep -l 'pages-are-gated'` returns **code/config in `packages/db` as well as `apps/web`**
(`packages/db/src/scope.test.ts` cites the idiom), which **widens this PR's file globs into
`packages/db`** — a parallel-work gate-1 consideration and a roadmap pillar note. It also returns
`test/bypass-is-contained.test.ts`, so that file _is_ touched (docblock only), contrary to the draft.

**Corrections to the parent plan** (made here; dated history is not rewritten): the `1c` rename to
`pages-need-a-session.test.ts` never shipped, so `1d` inherits it; `e2e/gate-login.ts` is
`e2e/login.ts`; and its site count is replaced by the command above.

## File-by-file

Both tables are **driven by the commands in § Design 4**. Rows below record _decisions_, not the
enumeration — a row is needed only where the edit is not "delete the gate reference".

### PR A — the one-way door

**Delete:** `lib/access-gate.ts` (+test) · `lib/dal/gate.ts` (+test) · `app/gate/` · `e2e/login.ts` ·
`e2e/gate-prefetch.spec.ts`.

| Path                                                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy.ts`                                                 | Delete the import, cookie read, bounce and the ARM 1 block `:186-192`. Add `withRetiredCookies`. Rewrite the module docblock `:14-27`, `withClerk`'s `:126-137` ("the gate runs FIRST… the only thing THE PROXY ITSELF enforces" — after `1d` Clerk runs on all matched traffic) and the matcher comment `:249-252`: the matcher body stays wide, its _justification_ changes to "`auth()` must be able to answer and headers must land". That rewrite is the only thing preserving SEC-1's lesson where the proxy enforces nothing. Re-pin `:48`'s "7.9.15" → **7.9.19**. ⚠️ On a **development** instance a cookie-less request now hits `DevBrowserMissing` → a handshake redirect, changing what a signed-out `pnpm dev` visitor sees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `proxy.test.ts`                                            | **~200-line edit, not a comment sweep.** 451 lines; imports three deleted symbols at `:6`; `run()` threads `{ gated }` through 24 sites. Delete the routing describe; reshape `run()`; add the matcher pin and the four tombstone cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `app/sign-in/[[...rest]]/page.tsx`                         | Open Q1: promote the privacy link out of the ternary, delete the access-code button, add `SIGN_IN_COPY.invitation` above the mount. Add `rootBox`/`cardBox: 'w-full'` and `header: 'hidden'` (PR 0). ⚠️ **The appearance object moves to `lib/clerk.ts`, not an export from this route module** — Next reserves a route file's export surface, AGENTS.md says route files stay thin, and `lib/clerk.ts:1-14` already declares itself the home for "Clerk wiring facts, in one module … three call sites must agree". The cascade contract is **three** files (`globals.css:6` layer order, `layout.tsx:88-95` `cssLayerName`, the `elements` map), so half of it already lives outside the page. Derive the class from `MIN_TAP_TARGET_PX` rather than re-typing `'min-h-11'` beside a comment asserting they are equal. Rewrite `:43-51` (the footer is the exit) and record the **ordering invariant**: the page's own disclosure renders above the Clerk mount in both states; "Secured by Clerk" is a vendor assurance and must never be the first mention of Clerk. Record that no `aria-describedby` is possible into vendor DOM, and that placement + `text-foreground` are the compensations — so the next author does not "fix" it with a client effect. |
| `components/profiles/sign-out.tsx` **and** `.test.tsx`     | The component's docblock names `mp_gate` four times, including a "PERMANENT LOCKOUT… bounced to `/gate`" branch that cannot exist after `1d`. It is a claim about the boundary → PR A. In the test, **only `:35` becomes tautological**; `:36`/`:37` still stop sign-out hand-rolling cookie clearing, which matters because the `tz` cookie exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lib/rate-limit.ts` (+test)                                | Delete `GATE_RATE_LIMIT`, `limiter`, `checkRateLimit`. 🔴 **Rebind `isRateLimitConfigured`** (`:125` is `limiter !== null`) to `mutationLimiter` or the file does not compile; `ai-1-nl-logging.md:507` cites it as a live mitigation. The test's three structural suites lose their comparand — replace with absolute `MUTATION_RATE_LIMIT` sizing and a constructor pin on `{ ...MUTATION_RATE_LIMIT, prefix: 'mat-plan:mutate' }`, or the surviving limiter's keyspace is asserted by nothing. Rewrite the "two limiter instances" docblock and `buildLimiter`'s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mutation-entry.test.ts`, `actions.test.ts`                | Both `vi.mock('@/lib/dal/gate')` — a module PR A deletes. **Switch** the boundary assertions to the session conjunct (`actions.test.ts:1639` is `expect(hasGateAccess).toHaveBeenCalled()`), never widen to an alternation. `actions.test.ts` is cited by `add-server-action/SKILL.md:20`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pages-are-gated.test.ts` → `pages-need-a-session.test.ts` | Four suites change. `git mv` as its own commit ahead of the rewrite. ⚠️ `it.each([])` **registers no tests** (probed, Vitest 5.0.5, no warning), so the emptied allowlist needs `expect(ALLOWLIST).toEqual([])` — plus a sentence saying a future entry must reinstate the `existsSync` loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `lib/constants.ts`                                         | Delete `GATE_COPY`, `SIGN_IN_COPY.gateCta`/`codeStillWorks`; add `invitation`; `gateCta` → `signInCta`. ⚠️ **`COOKIE_MAX_AGE` stays** (tz cookie). Stale premises at `:143-147`, `:148-159`, `:217`, `:333`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `lib/public-paths.ts` (+test)                              | Docblocks only — but it is **not "untouched"**: `:6-9`'s "the proxy, the test and the capture read one definition" leaves only the test; `:35-39`'s `/sign-in`-subtree justification rests on the deleted gate bounce (the correct reason, Clerk's catch-all + OAuth callback, is already at `:29-31`); `:38` cites `requireGatedPage()`. The test keeps `'/gate'` in an `it.each` — stale, not wrong.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `globals.css` + the `lib/clerk` test (PR 0)                | 🔴 `@layer clerk;` is declared **before** `@import 'tailwindcss'`; flip it and `min-h-11` stops applying to the Google button. Three corrections to the draft's version: (1) **"nothing tests this file" is false** — `app/design/tokens/token-sets.test.ts:40` already reads `globals.css` and `:161-168` already binds it to the tap-target bar derived from `MIN_TAP_TARGET_PX`; (2) `indexOf(a) < indexOf(b)` **passes vacuously when `@layer clerk` is deleted** (`-1 < 0`), which is the exact regression it is named for — assert positively: `expect(layer).toBeGreaterThanOrEqual(0)` then `expect(layer).toBeLessThan(importIdx)`; (3) **strip comments first** — `globals.css:1-5` is a comment discussing `@layer`, `@import` and `clerk`, and `token-sets.test.ts:44-49` documents this precise trap. Colocate it with the appearance pin so one guard owns one invariant.                                                                                                                                                                                                                                                                                                                                                                           |
| `e2e/a11y.spec.ts`                                         | 🔴 **`:846`'s count STAYS `1`** — the draft said `0`, contradicting its own Open Q1 two sections earlier. Q1 moves the privacy link _out_ of the `configured` ternary, and that `<Link>` is inside `<main>` (`page.tsx:57` opens it, `:71-73` is the link), so the dark state has exactly one. `0` would also be red on both viewports **and** skip the `expected === undefined` "selector is wrong" floor at `:727` — a pin measuring nothing. What changes is _which_ link: retitle `:839` ("its one way out" goes false) and rewrite `:833-845`, which asserts `PRIVACY_PATH` is deliberately absent. ⚠️ That link has **never been measured by anything**, because until now it rendered only in the lit branch CI cannot reach; `QUIET_LINK_CLASS` carries `min-h-11`, so `:733` passes. Add positive content assertions (`<h1>` text, `notYet`) regardless, and the footer exit assertion mirroring `privacy.spec.ts:80-86`. The `/gate` scan `:787-794` is a **deletion**, not a repoint (`/sign-in` is already scanned at `:839-846`).                                                                                                                                                                                                                    |
| `scripts/capture.ts`                                       | 🔴 **In neither table in the draft, and PR A breaks it.** `:5-6` imports `gateLogin` from `e2e/login` **and** `isUngatedPath` from `lib/access-gate` — both deleted — and `apps/web/tsconfig.json` includes `**/*.ts`, so `scripts/` is inside the typecheck project: `pnpm verify` goes red. `screenshot-ephemeral.ts:36` and `screenshot.ts:2` both import `captureScreenshot` from it, so the screenshot pipeline **PR A itself owes lit and dark captures from** dies with it. Swap `isUngatedPath` → `isPublicPath`, drop the conditional `gateLogin` (the harness already sets the bypass principal), and say how a session-gated route is captured after `1d`. Move `screenshot-ephemeral.ts:933`'s `${baseUrl}/gate` readiness probe here too — the same rule lives in two harnesses and the draft repointed only `playwright.config.ts:42`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `lib/safe-redirect.ts`                                     | 🔴 **Also in neither table, and no § Design 4 command can find it** — it contains no gate symbol and no `mp_gate`. Its only two production callers are `app/gate/page.tsx:22` and `app/gate/actions.ts:89-90`, both deleted, so PR A leaves a pure-logic module and its test with **zero** callers while its docblock claims three. **Decide, don't go silent:** keep it and rewrite the docblock to name the real surviving reason (the sign-in `?from=` escape hatch recorded at `page.tsx:112-119`, and `/api/sync`, are the next callers — SEC-4's rule is pre-positioned, not live), or delete it with the gate. `sign-out.tsx:31` currently instructs a future author to route through it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lib/sentry-scrub.ts` (+test)                              | Names the access code in **four** places. Rewrite for Clerk's cookies. **Probe RED**: a redaction guard rewritten wrong passes because the cookie bag was dropped for an unrelated reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Docs in PR A** (claims about the boundary): `.github/SECURITY.md` · `notice.md` + `notice-content.ts`

- `notice-content.test.ts` + `privacy.spec.ts:45` · `data-inventory.md` · `features/write-path.md` ·
  **`features/programming.md`** (owns `routine/`; `guides:check` fails without it, and its `:273-283` is a
  _second copy_ of the gating rule → shrink to a pointer) · `architecture.md` (component diagram `:33`,
  `:42`, `:49`; prose `:125-167`, `:209-212`; §2b `:236-254`; deploy `:467`) · `design.md:81` (the false
  both-themes claim) · `app/privacy/page.tsx` + `plan.md:1864` + `status.md:58` · `status.md` · `roadmap.md`
  · changelog fragment · `beta-1.md` · `plan.md` (link this plan).

**`.github/SECURITY.md` carries three claims `1d` falsifies, two with no symbol to grep** (command 3
is what finds them): `:105-107` says _"the rate limiter is wired to the gate login only, so a gate-code
holder can still mint unbounded `movements` rows"_ — false after `1d` in the **safe** direction, so
leaving it tells a reader a live minting primitive exists; `:278` still lists **"auth"** as a
rate-limited surface, and `1d` deletes the only auth limiter. ⚠️ **AGENTS.md's identical rate-limit
line moves here too**, into the same PR — the draft had SECURITY.md in A and AGENTS.md in the tail, so
between them two copies of one claim would disagree.

**`.github/SECURITY.md:168` — split the claim by what is assertable, and note `SameSite` is the point.**
The row's stated job (`:162-168`) is _"Lax is what stops a cross-site POST carrying the session"_;
`httpOnly` stops script theft and no CSRF, so a rewrite about `httpOnly` alone would be accurate prose
that no longer supports its own table. `@clerk/shared@4.41.0 → cookie.mjs` sets **no `sameSite`** in its
js-cookie wrapper, so a client-written Clerk cookie takes the browser default — not uniformly `Lax`.
The dated production `Set-Cookie` dump must therefore capture **`SameSite`**, or it measures the wrong
attribute. State the honest conclusion: post-`1d` the CSRF story is Next's Origin-vs-Host check **plus
a vendor default** — two layers and a dependency, not the three the row claims. The draft's instruction would
have written a _new_ false claim. After `1d` the only cookie this repo sets is `tz`
(`tz-sync.tsx:24`), deliberately neither `httpOnly` nor `secure` because a client writes it — state
that as fact. Clerk's are **observed and dated** from a real production `Set-Cookie` dump. ⚠️ Do not
write a flat "`httpOnly` does not apply": that is true on the custom domain, where clerk-js
(a `js-cookie` wrapper, **`@clerk/shared@4.41.0`** — the draft said 4.40.0) reads them, but on the
`*.vercel.app` alias the auto-proxy forwards FAPI's own `Set-Cookie` verbatim with attributes Clerk
chooses, which can include `HttpOnly`. Add a re-verify-on-bump obligation and extend it to a domain or
alias change.

**`app/privacy/page.tsx` — a second obligation named in code.** `:23`: _"It comes off at AUTH-1 chunk
1d… named precisely."_ Not mechanical: its premise is that the gate's limiter is not yet armed, and
`1d` **deletes** that limiter rather than arming it. Whether `/privacy` becomes indexable is a
publication decision this plan must state either way (§ Open questions 2).

**Privacy.** 🔴 **`notice.md:125` — the Upstash processor row — and the draft walked into its own
trap.** The row says the IP is taken _"to stop someone guessing the access code"_; `1d` deletes the
only IP-keyed limiter, so Upstash stops receiving an IP **entirely** and "Both are counters" becomes
singular. The draft named `notice-content.test.ts:196` — whose pinned string **is quoted from line
125** — and instructed repointing it "to surviving text at the same depth", which would turn the probe
green while leaving a false processor claim published. Keep `:196` pointed at the **rewritten** row.
Then: the retention table `:157` (the notice's **only** mention of `mp_gate`) and
`:160` (the IP row — `1d` deletes the only IP-keyed limiter, so Upstash stops receiving an IP
**entirely**); limitation 1 `:93-101` (⚠️ its ✅ clause does **not** survive unchanged — `:97` ends
"even with the code"); limitation 3 `:108-113`; `:88`, `:181`, `:209-212` (the deletion-confirmation
friction loses its published _reason_; keep both controls and re-subject the sentence — the true reason
is already at `:219-222`); the dating apparatus `:3`, `:95`, `:102`, `:109`, `:278-283`.
⚠️ **`:244-245` is inside a dated section** — add a **new** dated section rather than editing history.
It owes three sentences: the supersession, the Upstash reduction, and that an account refused at
sign-in still had its email, name and picture sent to Clerk and can have that record deleted without an
invitation (there is no household to protect).
⚠️ **Three pinned strings plus an e2e pin** — `notice-content.test.ts:193`, `:196`, `:320` and
`privacy.spec.ts:45`. `:193`/`:196` must be **repointed to surviving text at the same depths**, not
deleted, or the flattener's depth coverage silently narrows — what made PRIV-1's placeholders
invisible. 🔴 Do not preserve "That follows from (1) and (2)" just to stay green: limitation 1's
premise changes underneath it, so the string would pass while its referent is false. Rewrite the
derivation to name its premises in words and update the pin.

`data-inventory.md`: §7 `:390` (the `mat-plan:gate:<ip>` key; its "Wired? yes, one endpoint" cell is
_already_ false since `1c-3b`) · §8 `:418` (cites the deleted `GATE_RATE_LIMIT`) · `:416` (the `tz` row
loses "the same constant"'s antecedent) · §4 `:272-282` (the `| Un-gated route |` header; the `/sign-in`
row's justification is the deleted gate bounce; the `noindex` paragraph) · the staleness command
`:80-104`, which must be **run**, not only rewritten. The re-read log entry is scoped **§4 / §7 / §8** —
the first entry recording a _reduction_ in what a processor receives.

### PR A, continued — the suppliers (folded in; no separate PR)

Driven by § Design 4's commands: `vitest.config.ts` · the harness scripts (⚠️
`screenshot-ephemeral.ts` has a **live assignment** at `:1030`, not only the `:985` injection) ·
`ci.yml` · `.env.example` · the preview-isolation self-test fixture (swap the key — the real guard's
`REQUIRED_PER_SCOPE` is `['DATABASE_URL']` only) · `generate-privacy-notice.ts` + `.test.ts`
(**coupled to `vitest.config.ts`; they travel together**) · `README.md` · `.local-secrets/README.md` ·
`service-setup.md` · `deploy.md` · `.gitleaks.toml` · `.claude/skills/ui-screenshot/SKILL.md` ·
`runbooks.md` · `AGENTS.md`'s rate-limit line · its own changelog fragment.

🔴 **`generate-privacy-notice.test.ts:178` is `not.toContain(process.env.ACCESS_GATE_PASSWORD!)` — an
env read, not the literal fixture the draft claimed.** Removing `vitest.config.ts:38` makes it
`not.toContain(undefined)`, which **passes silently** (probed, Vitest 5.0.5). Retarget it to a
committed fixture secret so the guard that proves a live secret cannot be compiled into a served module
keeps guarding, and rename the hostile fixture's template hole so it does not match the acceptance grep.

**`runbooks.md` gains** the "nobody can sign in to production" entry — the reusable diagnostic is
`x-clerk-auth-reason` on any app response, separating _not signed in_
(`session-token-and-uat-missing`) from _expired_ (`session-token-expired-*`) from _the server cannot
verify a token it was given_ (`unexpected-error`, Clerk's default bucket, where a key/instance mismatch
lands). Three bullets: the maintainer cannot sign in; a family member cannot (invite at Clerk, then
re-point the membership row — nothing under `apps/web` writes `household_members`); and a stranger who
got far enough to be refused. It **loses** the scope-miss rotate-the-code remedy, the sign-out §3
`mp_gate` invariant, and "Rotate a secret"'s only worked example (§ Open questions 3).

## Test plan

- **`pnpm verify`** — includes the matcher pin, the tombstone cases and the `globals.css` layer-order test.
- **`pnpm e2e:local`** — required for PR A; the only thing exercising the reshaped entry point.
- **Probe every edited guard RED** — the list is the union of the § Design 4 commands' hits that carry
  assertions, and explicitly includes the ones whose failure mode is _vacuity_: `sentry-scrub.test.ts`
  (redaction), `notice-content.test.ts` (`:193`/`:196` depth coverage),
  `generate-privacy-notice.test.ts`, the emptied `ALLOWLIST`, and **the matcher pin itself**
  (add `{ source: …, missing: [{ type: 'header', key: 'next-router-prefetch' }] }` and confirm red —
  its claimed value is "fails on the exact SEC-1 mutation", which only a probe establishes).
- **Stale-claim sweep, two passes** — `git grep -l '1d'`, then the § Design 4 behaviour commands, plus
  `pages-are-gated`, `SIGN_IN_COPY`, `LANDING_COPY`, `GATE_COPY`. The latter rot as _arguments about a
  label_, which no behaviour grep catches.
- **Screenshots.** Ephemeral captures labelled **"dark state"**; lit captures labelled **"development
  instance"** at 360/390/820/1280, light **and dark**, from a keyed local run.
- **PR body** embeds the updated §2b flowchart and the `beta-1.md` chart.

## Risks / rollback

| Risk                                                                                                      | Mitigation                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Revert does not boot** (`lib/env.ts` validates at import) — **PR A's property**, not B's                | Fix forward. The secret leaves the environments only in B, after A.                               |
| **Total lockout** — `/sign-in` renders Clerk only `if (clerkIsConfigured())`                              | Pre-flight rows 1-4; the `x-clerk-auth-reason` runbook entry. ⚠️ Invite-only has no second layer. |
| **A guard that passes for the wrong reason**                                                              | The probe list. Three such guards were found _in this plan_ by the panel.                         |
| **A mangled Clerk handshake cookie** presents as the lockout symptom with a different cause               | § Design 3's header-append, fired only when `mp_gate` is present.                                 |
| **`e2e` is not a required check**                                                                         | The `review-pr` shipit bar is the only thing holding it. Do not merge on a red `e2e`.             |
| **Session expiry mid-practice** — `runbooks.md:1623` unticked, and after `1d` a kid cannot be told a code | Name the configured lifetime in the PR body, or tick the box here.                                |

## Out-of-scope / deferred

- **No migration** — `db-safety-reviewer` not on the panel, confirmed by reading the file list.
- **The un-bypassed-server e2e**, and `landing.spec.ts:131`'s variant 1 — **one** `tech-debt.md` row
  naming both halves.
- **No auth rate limiter**, and 🔴 **the draft's justification answered a different question.** It said
  _"after `1d` no unauthenticated request does DB work"_ — true, and irrelevant: the population the
  deletion changes is **authenticated-without-membership**, and `lib/dal/household.ts:204-209` already
  says what happens there, naming this chunk: _"States B′ and C are reachable on every page read, and
  page reads are not rate-limited at all … At `1d`, the chunk this one unblocks, 'admitted by the
  instance' is the only requirement left."_ Each `GET /p/<uuid>` from such a principal costs a scoped
  miss **plus** `reportScopeMiss`'s allowlisted unscoped existence read (`household.ts:444-450`),
  unbounded. **The true sentence:** what is lost is the only limiter keyed on something a caller cannot
  choose, for requests that have no principal; what replaces it for page reads is nothing, and the DAL
  says so. Fold it into the same `tech-debt.md` row. ⚠️ With Turnstile off, the residual on the one
  remaining door is Clerk's own limits only — and `proxy.mjs:88` prefers caller-supplied
  `cf-connecting-ip`, which Vercel does not set, so even that is caller-chosen on the relay path.
  **The boundary itself holds** and that is verified, not assumed: every DAL consumer refuses before
  touching household data (`profiles.ts:53-54`, `:107-110`; `entries.ts:319,395,492,536,552,571`), and
  `findOrCreateMovementId` sits at `entries.ts:501`, **after** the scope throw at `:492` — so the
  unbounded-`movements` primitive `.github/SECURITY.md:105-107` records as live is **not** reachable
  by a membership-less session.
- **Clerk Protect's CSP origins** — `protect_config.loaders` is armed and its probes to
  `*.client.protect.clerk.com` are refused by `connect-src`, which is a _separate_ mechanism from the
  `captcha_enabled: false` that `runbooks.md:1623` records. Being resolved on the Clerk instance rather
  than by widening the policy. Independent of `1d`.
- **Wiring Clerk `variables` to our design tokens** — see § The lit panel finding 4.
- **Removing the secret from Vercel/Actions** — a post-merge operator step, in the runbook.

## Open questions

1. ~~The sign-in screen's forward control~~ — **RESOLVED** by the lit panel. See above.
2. **Does `/privacy` become indexable?** Its `noindex` names this chunk, but its premise (the gate
   limiter) is deleted rather than armed.
3. **"Rotate a secret" loses its only worked example** — give it the Clerk secret key (a procedure now
   actually exercised) or mark it unwritten. A decision, not a question.
4. **The correction ledger's `--apply` date** — the maintainer's to supply. CI re-runs that correction
   on every e2e run, so "has `--apply` run" is not a single-event question.

## Review-response log (adversarial panel)

> **Twenty-two lens-runs.** Round 4 (six lenses on the final text) reversed three of the author's own
> _fixes_ — the matcher pin was a tautology, deleting the prefetch spec lost coverage that is still
> observable, and dropping the `mp_gate` const rested on arithmetic the test plan falsifies — and
> recovered a committed obligation (ID-1's six items) that the first sixteen runs all missed.
>
> **Sixteen lens-runs in rounds 1-3.** Round 1: nine lenses on the first draft (correctness 166k · scope 125k ·
> security 191k · architecture 120k · reuse 123k · privacy 103k · ux ×3 94k/105k/87k). Round 2: four
> re-reviews of the reconciliation (scope 85k · architecture 89k · correctness 117k · security 129k).
> Round 3: the lit-screen panel, three lenses (97k · 105k · 95k). Cost only — it can never show what a
> cheaper lens missed.
>
> ⚠️ **Model override, recorded rather than hidden:** the pinned model returned 429, so the panel ran
> on Opus by agreement; lens definitions, prompts and checklists unchanged.

### ID-1's six keep-open items (`docs/plan.md:1168` binds every auth chunk from 1c on)

Only `1c-3a` and `1c-3b` carry this section; `1c-4` shipped without it and this plan had no such
section until a lens found the binding. **`1d` is a deletion, and all six are untouched:**

1. **The principal is a login, never a profile** — no column, type or assumption tying a profile to a
   login is added or removed.
2. **Every access decision still goes through `getHouseholdScope()`** — unchanged; `packages/db/src/scope.test.ts`
   still enforces it, and the entry points keep `requireSession()`.
3. **State D (two memberships throws) stays a Beta 0 invariant** — nothing outside the resolver is
   taught to rely on one-household-per-person.
4. **Nothing pins an athlete to a household** — no key, unique index or cache key on
   `(household_id, profile)` is introduced.
5. **No age-based permission logic** — `profiles.kind` / `birthdate` are not read by anything this
   chunk touches.
6. **Household roles stay a shared const plus a CHECK** — untouched.

Narrowing the boundary cannot newly constrain any of the six; removing the _weaker_ of two controls
leaves the later guardian/athlete-self widening exactly where `1c` left it.

### What the panel changed

**Both original design decisions were replaced.** § Design 2's second un-bypassed server was killed by
three lenses independently and replaced with a 3-line matcher-shape pin that is cheaper _and_ pins
SEC-1's actual mutation. § Design 3's `cookies.delete()` was replaced with a header append after two
lenses found, by different mechanisms, that it would corrupt Clerk's own `Set-Cookie` on the response
that establishes a session.

**Two committed prerequisites were recovered** — the lit-screen UX panel (`runbooks.md:1616-1622`) and
`/privacy`'s `noindex`, both of which name this chunk and neither of which the draft mentioned.

**Roughly twenty false or incomplete claims in the author's own drafts were corrected**, listed in the
file table and § Design 4 rather than repeated here.

### Conflicts, resolved in favour of the lens that probed

| Claim                                                                           | Resolution                                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A second `webServer` races entry 1's build (architecture, scope)                | **Disproved.** Playwright awaits entries sequentially (`runner/index.js:6331-6341`), probed by two other lenses. Moot — option A was dropped. |
| The Google button is ~40px, so `min-h-11` is not landing (lit ux-2, from a PNG) | **Disproved by DOM measurement:** 44.0px, `min-height: 44px` computed. The lever lands.                                                       |
| The Clerk card is `max-width: calc(100vw - 2rem)` (lit ux-2, inferred)          | **Corrected:** it is a fixed `width: 400px`. The overhang is real (48px at 1280) but the mechanism is different, and so is the fix.           |
| A mis-tap on the Clerk badge leaves the app (lit ux-3)                          | **Corrected:** `target="_blank"`. The 44px failure stands; the navigation concern does not.                                                   |

### Rejected, with reasons

| #   | Critique                                                | Why rejected                                                                                                                                                                                                          |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U8  | The code-only holder's lockout is new at `1d`           | They have been locked out since `1c-3b`; `notice.md:252-257` already says so. What `1d` removes is the _deterrent_, which is why a disclosure is owed — not a new state.                                              |
| X3  | Option B's rejection reasoning was wrong                | **Accepted in part.** The argument was wrong (the anonymising polarity is fail-safe); the decision stands on the narrower ground that production code would read a request header to decide authentication.           |
| —   | Add a retry control for the 15s CDN loader              | A control cannot fix "no JS arrived"; the honest fallback is server-rendered text, and a client-side reveal would put `'use client'` on a page whose premise is that it stays server-rendered.                        |
| —   | Unit-test "exactly one `<h1>` in the a11y tree"         | In jsdom there is no Clerk CSS, so it degenerates to "the `hidden` class is in the object" — already covered by pinning `SIGN_IN_APPEARANCE`. The rendered fact belongs in the tech-debt row as a dated verification. |
| —   | Lower `MIN_TAP_TARGET_PX`, or allowlist the Clerk badge | `a11y.spec.ts:172-173` makes "no allowlist" an explicit principle, and an allowlist entry is how a vendor exemption becomes a house exemption. Exclude by selector; record the exception.                             |

### Round 4 — what changed, and one premise the author got wrong

The author told three lenses that `runbooks.md:1443-1446`'s two self-created accounts were uninvited
third parties whose records persist in Clerk. **They are both the maintainer's own Google accounts**
(production Users list, 2026-11-04). The premise was retracted mid-run and the privacy and security
lenses withdrew P0 findings built on it.

🔴 **That error is itself a finding, and it is cheap to close.** `runbooks.md:1466` states _"an
unrestricted instance means Clerk holds uninvited people's email addresses"_ in the **present tense**,
with no disposition recorded anywhere in `data-inventory.md`'s re-read log. Two independent readers —
the author and the privacy lens — reached the same false P0 straight from the committed text. `1d`
already re-reads §7, so add the dated disposition (both accounts were the operator's own; the trigger
fired and found no third-party data) and put `:1466`'s residual in the past tense.

Also accepted in round 4 and not repeated above: `safe-redirect.ts` and `capture.ts` rows; the §
Design 4 prose command; `.claude/**` added to the policy's "is updated" bucket; the `a11y.spec.ts:846`
count correction; the negative tombstone case; `SIGN_IN_COPY.invitation`'s two conditions; the
`lib/clerk.ts` home for the appearance object; the `globals.css` vacuity and comment-stripping; the
`/__clerk/*` auto-proxy disarm; and `runbooks.md:1263`'s step 6, which is household-scoped and so
structurally cannot reach a Clerk user with no membership.

**Rejected in round 4:** publishing a deletion _right_ for a refused sign-up in `notice.md` — the
procedure does not exist and `data-inventory.md:413`'s retention window is still ⏳, so the notice
states only what is true (the record exists, Clerk holds it) until lit-panel finding 5's production run
settles whether a refused sign-up leaves a record at all.

### Still open

Open questions 2-4; Q1 is resolved. **No blocking critique survives**, with one gate: § The lit panel
finding 5 owes a single production-instance observation, scoped to destination **(a)**, before PR A
merges. It cannot be answered from the development instance, and neither existing account can produce
it.
