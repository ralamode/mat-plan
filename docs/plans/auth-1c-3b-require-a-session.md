# AUTH-1 chunk 1c-3b — every entry point also requires a session

**Backlog:** `AUTH-1` ([plan](./auth-1-clerk-google.md)) · **Milestone:** [beta-1](../milestones/beta-1.md)
**Status:** DRAFT — rewritten after a correctness and a security panel. No implementation code committed.

## Acceptance

The twelve entry points start asking **who you are**, in addition to what they already ask. Done when:

- Each of the 4 pages, 7 actions and 1 Route Handler checks **both** the gate **and** a session,
  **in-process**.
- A visitor holding `mp_gate` but no session is sent to `/sign-in` by the page, not bounced in a loop.
- A visitor with neither still reaches `/gate`, and **a screen still tells them the code is one of
  two things they need.**
- The 7 actions rate-limit on the principal, with a refusal a reader can act on.
- **Sign out exists and clears the Clerk session only.**
- `data-inventory.md` records what Clerk and Upstash now hold.

## 🔴 The design changed between drafts: AND, not replace

The first draft **swapped** each gate check for a session check. A security panel showed why that is
a widening, and it is the finding that reshaped this plan.

`getHouseholdScope()` (`lib/dal/household.ts`) resolves _"the one live household"_ for **any**
request and does not consult the principal until **1c-4**. So in the window `1c-3b → 1c-4`, a swap
would make the access predicate:

> **(any valid Clerk session on this instance)** AND **(a gate cookie, checked only in middleware)**

Today every one of the twelve checks the gate **inside the work** — `requireGatedPage()` in the four
pages, `hasGateAccess()` in the seven actions, `isValidGateCookie()` in the handler. A request that
bypasses the proxy (a CVE-2025-29927-class `x-middleware-subrequest`, a matcher edit, a future
rewrite — **SEC-1's actual scar**, where a prefetch header skipped the matcher) is refused in-process
today. After a swap it would meet only a session check, and a session is obtainable by anyone the
Clerk instance admits.

`.github/SECURITY.md` → Authorization: _"Middleware is **NOT** the auth boundary (CVE-2025-29927) —
the real checks live in the DAL, on every read and write."_ `proxy.ts` says the same about itself.

**So every site gets both, in-process**, and the gate check is deleted at **1d**, _after_ `1c-4` has
made the scope membership-derived.

⚠️ **The earlier draft's acceptance was also wrong about why this is safe.** It cited the claim
correction (`household_members` has one `owner` row in production). **Nothing reads that table until
`1c-4`** — it buys this chunk nothing. What actually bounds exposure here is the surviving gate, which
the draft treated as vestigial.

🔴 **Ordering constraint, now a security property rather than a preference: `1c-4` must land before
`1d`.** Recorded in [beta-1](../milestones/beta-1.md)'s obligations table.

### What that means for `pages-are-gated.test.ts`

Two **required** calls per site is not the alternation the file forbids. Its own note bans _widening a
regex to accept either_; this adds a second regex that must also match. Both suites stay green and
both stay meaningful.

## Design

### 1. The twelve call sites — add, don't swap

| Where          | Today                                    | After                                                                    |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| 4 pages        | `await requireGatedPage()`               | `await requireGatedPage()` **then** `await requireSession()`             |
| 7 actions      | `if (!(await hasGateAccess())) return …` | that, **then** `sessionUserOrNull()` → refuse, then `checkMutationLimit` |
| export handler | `isValidGateCookie(…)`                   | that, **then** `sessionUserOrNull()`                                     |

Spell the page call `await requireSession();` so `pages-are-gated.test.ts`'s
`\bawait\s+requireSession\(\)` matches. Three of four pages discard the principal; that is fine.

🔴 **`export const dynamic = 'force-dynamic'` on the handler, and the reason is SECURITY, not the
test.** `getCurrentUser()` can return **before touching any dynamic API** — the 1c-3a bypass returns
from an env read, and `!clerkIsConfigured()` returns immediately — so post-change the handler can
have no dynamic signal at all, and a Route Handler inherits no segment config. Under ADR 0006 the URL
carries no tenant, so a cached response is **one household's CSV served to another**. The source-text
test is a second reason, not the reason; write the first into the directive's comment, or a future
author deletes it the day they change the test.

### 2. The proxy still has to change — both arms

`proxy.ts`'s `if (authed && (pathname === GATE_PATH || pathname === '/')) → APP_HOME_PATH` loops for
every cookie-holder without a session, which is **everyone at deploy**:

| From       | Tap                     | Lands | Then                            |
| ---------- | ----------------------- | ----- | ------------------------------- |
| `/sign-in` | the access-code button  | `/p`  | `requireSession()` → `/sign-in` |
| `/sign-in` | the footer's "mat-plan" | `/p`  | `requireSession()` → `/sign-in` |

The second arm also means such a visitor **can never see the landing page**. Delete the branch: its
own comment concedes it is _"convenience routing … NOT authorization"_, and the security panel
confirmed an unauthenticated caller never reaches it (the un-gated bounce returns first, and the
`authed &&` conjunct is false for a cookie-less caller — behaviour for them is bit-identical).

⚠️ **Collateral the first draft did not carry.** Deleting it turns **two committed e2e cases red**
and falsifies **four committed rationales**:

- `e2e/landing.spec.ts` — _"/ goes straight to the picker"_ asserts `toHaveURL(APP_HOME_PATH)`; and
  the _"Household sign-in leads to the gate"_ case asserts `LANDING_COPY.gateCta` → `GATE_PATH`.
- `app/page.tsx` (_"the proxy sends them to the picker"_), `app/gate/actions.ts` (its `from === '/'`
  substitution is justified by that forward), `lib/constants.ts`'s `APP_HOME_PATH` HH-1 note, and
  `SIGN_IN_COPY`'s _"the exit points at `GATE_PATH` … because `proxy.ts` sends a cookie-holder on"_.
- Check `proxy.test.ts` for a case pinning the deleted arm.

### 3. 🔴 The copy states the AND — it does not delete the gate route

The first draft deleted `SIGN_IN_COPY.codeStillWorks` and `gateCta` and re-pointed
`LANDING_COPY.gateCta`. **After those edits nothing in the app links to `/gate` while `/gate` is
still mandatory** — a dead end turned silent. And `codeStillWorks` is _true_ under the AND; deleting
it is the dishonest direction.

| Constant                      | Becomes                                | Why                                                                         |
| ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `SIGN_IN_COPY.codeStillWorks` | states the AND and the order           | both doors are required until `1d`                                          |
| `SIGN_IN_COPY.gateCta`        | **kept**                               | it is the only in-app route to a door that is still mandatory               |
| `LANDING_COPY.gateCta`        | **kept**, pointing at `GATE_PATH`      | same reason; it is not mis-naming a door once the copy says both are needed |
| `GATE_COPY.subhead`           | says the code is **one of two** things | _"to continue"_ is true for a session-holder and false for everyone else    |
| `NO_HOUSEHOLD_COPY.notYet`    | **deleted**                            | this chunk ships the control                                                |

### 4. Sign-out: a client component, and a placeholder the harness can see

**There is no server-side `signOut` at `@clerk/nextjs@7.9.19`** (the installed version — an earlier
draft cited 7.9.15, which #316 superseded; the conclusion holds at both). `signOut` is absent from
the server entry; `SignOutButton` exists only on the client boundary. `revokeSession` does **not**
clear the browser cookie, so "Sign out" → hand over the tablet → Back → **still signed in**, which is
#303's failure mode.

🔴 **It clears the Clerk session ONLY.** _(Settled by the maintainer, 2026-10-29.)_

| Clears                 | Honest?                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clerk session only** | ✅ Everything the session protects is gone. `mp_gate` remains, and under the AND it is still half the boundary — so the device is not "signed in", it is "allowed to be asked". |
| Clerk + `mp_gate`      | ❌ **Permanent lockout** — bounced to `/gate`, needing the shared code to re-enter their own household. After `1c-4` that reader is an invited parent who does not have it.     |
| `mp_gate` only         | ❌ What #303 did.                                                                                                                                                               |

A test pins that `GATE_COOKIE_NAME` is untouched, because "sign-out doesn't clear the gate cookie"
reads as an oversight and the obvious "fix" is the lockout.

🔴 **Neither harness can render it**, and the first draft claimed the opposite. Both deliberately
blank the Clerk keys (`e2e-local.ts`, `screenshot-ephemeral.ts`), so `clerkIsConfigured()` is false →
no `<ClerkProvider>` → no control. 1c-3a supplied a **principal**, not **keys**, and arming real keys
would kill `theme.spec.ts`'s one-way zero-egress assertion.

**So the block renders in two forms.** When `clerkIsConfigured()` is false, a **provider-free,
disabled placeholder** — same markup, same `min-h-11`, same `aria-describedby` line, no Clerk import.
The harness then captures the block and axe measures the target; the live control is captured from a
keyed `--use-live-db` run, and verified by a **manual runbook step** (sign out on the dev instance;
assert in devtools that Clerk's cookies are gone, `mp_gate` remains, and `/p` lands on `/sign-in`).
That step goes in `runbooks.md`, not in a test that does not exist.

⚠️ What actually clears the cookies is `@clerk/clerk-js`, fetched from a CDN at a floating major and
absent from the lockfile. Our assertion can only be that **our** code names no cookie.

### 5. Placement and shape

`p/page.tsx`'s `mt-auto` block, `flex flex-col gap-6`, with `border-t pt-6` between the theme
`<fieldset>` and the sign-out group, theme first. **Stack, never a row**: at 200% text the theme group
alone is ~356px against a 328px budget and survives only by `flex-wrap` _inside a child_.

`variant="outline"`, recessive. **No confirmation dialog** — the risk is a mis-tap, whose fix is
placement and recession, and a confirm would ask the user to approve a consequence they cannot
evaluate. Instead one static line tied by `aria-describedby`: _"Signing out ends this session on this
device. Getting back in needs the Google account linked to this household."_ `text-foreground`.

Render disabled until `useClerk().loaded` — verified reactive at the installed version
(`ClerkContextProvider` memoises on `clerkStatus`). A dead-but-enabled button on the no-household
screen is the worst variant: the only prescribed action, silently inert.

### 6. The rate limiter needs copy, a placement rule, and a test that can fail

`checkMutationLimit` **fails open** by design, and under vitest `mutationLimiter` is always `null`
(the test env injects no Upstash), so **every call answers `allowed: true`**. A limiter call placed
after the write, or whose result is ignored, is invisible to the whole suite — the defect
`rate-limit.ts`'s own docblock was written to kill one level up.

- **Placement:** after the session refusal, **before** the zod parse and before
  `getProfileByPublicId`. A flood then costs zero DB work and the key is never caller-supplied.
  Not inside `logCheckinsAction`'s registry loop, where one user action would burn ~10 of 120 tokens.
- **Copy:** a distinct `RATE_LIMITED` string. Returning `NO_PROFILE_LOG` tells a kid mid-session
  _"No profile found to log against"_ and muddies the 404-never-403 argument `actions.test.ts` pins.
- **Observability:** a `Sentry.addBreadcrumb` on `reason === 'limiter-error'`, mirroring
  `gate/actions.ts`, so a permanently-dead fail-open limiter is visible.
- **Tests:** mock the limiter to `{ allowed: false }` and assert the typed refusal **and** that no
  writer, no `revalidatePath` and no `getProfileByPublicId` ran. Add a second required regex to the
  per-action source guard so an eighth action cannot drop the call with every suite green.

### 7. Two smaller corrections this chunk owes

- **`ScopeMissEvent.actor: 'gate_session'` becomes false here.** Its own comment says _"AUTH-1
  replaces this with a user."_ Change the literal to `'clerk_session'` — **a constant, no id**. The
  tempting fix is wrong: a requester's Clerk id in a third-party store is the same cross-tenant
  linkage the field's docblock forbids for the household id, and a new personal-data flow.
- **`requireSession()` drops the deep link.** `proxy.ts` went out of its way to preserve the query
  string through the gate (_"a gated `/p/x/routine?d=…` came back as a bare `/p/x/routine`, silently
  on the wrong day"_). The new door discards it. **Decision: accept the loss in this chunk and say
  so**, because restoring it means the app's first user-controlled redirect target, which must go
  through `safeInternalPath` (SEC-4) and needs its own review. Recorded so the next author does not
  read it as a bug.

### Out of scope

`1c-4`'s resolver. `1d`'s deletions (the gate check, `mp_gate`, `/gate`, `ACCESS_GATE_PASSWORD`).
The _"Signed in as \<email\>"_ line — it needs a Backend fetch or a JWT claim and owes the inventory a
row. **The export route's rate limit** — `tech-debt.md` names it as the eighth surface and assigns it
here; deferred to `1c-4` because it is the one surface where the principal is not yet the thing being
limited, and the tech-debt entry is amended in this PR to say so rather than left reading as paid.

## File-by-file changes

| Path                                                                                                   | Change   | Why                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/p/page.tsx`, `p/[profileId]/page.tsx`, `p/[profileId]/routine/page.tsx`, `design/tokens/page.tsx` | EDIT     | add `requireSession()` after `requireGatedPage()`                                                                                                                                             |
| `app/p/[profileId]/actions.ts`                                                                         | EDIT     | 7 × session refusal + limiter, after the gate check                                                                                                                                           |
| `app/p/[profileId]/export/route.ts`                                                                    | EDIT     | session check + `force-dynamic`; **also** fix its stale `/api`-matcher claim                                                                                                                  |
| `apps/web/proxy.ts`, `proxy.test.ts`                                                                   | EDIT     | delete the `authed &&` branch; drop any case pinning it                                                                                                                                       |
| `app/p/page.tsx` + `components/profiles/sign-out.tsx`                                                  | NEW      | the control and its placeholder                                                                                                                                                               |
| `lib/constants.ts`                                                                                     | EDIT     | the AND copy, `RATE_LIMITED`, delete `NO_HOUSEHOLD_COPY.notYet`, 2 stale docblocks                                                                                                            |
| `app/page.tsx`, `app/sign-in/[[...rest]]/page.tsx`                                                     | EDIT     | copy only — both keep their `/gate` route                                                                                                                                                     |
| `lib/dal/household.ts`                                                                                 | EDIT     | `actor: 'clerk_session'`                                                                                                                                                                      |
| `app/pages-are-gated.test.ts`                                                                          | EDIT     | 3 added regexes (page, handler, `BOUNDARY_CALL`) — added, not widened. ⚠️ Leave `:52`'s escape as `isUngatedPath`, not `isPublicPath`: `/gate` must stay exempt while the proxy bounce lives. |
| `app/p/[profileId]/actions.test.ts`                                                                    | EDIT     | session mock, the no-session case, the limiter cases                                                                                                                                          |
| `e2e/landing.spec.ts`                                                                                  | EDIT     | the two cases the proxy deletion reds                                                                                                                                                         |
| `docs/features/write-path.md`                                                                          | EDIT     | owns `lib/dal/` **and** `actions.ts` — the guide gate fails without it; and its _"1c-3 is a symbol swap"_ line is now false                                                                   |
| `docs/features/programming.md`                                                                         | EDIT     | owns `routine/`; says _"every gated page calls `requireGatedPage()`"_                                                                                                                         |
| `docs/privacy/data-inventory.md`                                                                       | EDIT     | §7 Clerk holds user records + sign-in logs; §8 retention; Upstash now keyed on a Clerk id                                                                                                     |
| `docs/runbooks.md`                                                                                     | EDIT     | the manual sign-out verification step                                                                                                                                                         |
| `docs/tech-debt.md`                                                                                    | EDIT     | the rate-limit entry: half paid, export deferred, and its gate-cookie sentence is now wrong                                                                                                   |
| `docs/milestones/beta-1.md`                                                                            | EDIT     | `1c-4` before `1d` as a **security** obligation                                                                                                                                               |
| `docs/changelog/…`, `docs/roadmap.md`, `docs/status.md`                                                | EDIT/NEW | same-PR rules                                                                                                                                                                                 |

## Risks / rollback

| Risk                                                         | Mitigation                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 A swap would leave `mp_gate` enforced by middleware alone | The AND. This is the whole reason the plan was rewritten.                                                                                                                                                                                                           |
| 🔴 Redirect loop for every existing cookie-holder            | § 2, plus an e2e case: a `mp_gate`-holder gets the landing at `/` and the gate at `/gate`, with **no** redirect to `/p`. ⚠️ Stated that way deliberately — the harness arms a principal process-wide, so "no session" is not a precondition any spec can establish. |
| The sign-out button is inert while clerk-js loads            | Disabled until `loaded`.                                                                                                                                                                                                                                            |
| A limiter call lands somewhere useless and nothing notices   | § 6's mocked-refusal tests + the source guard.                                                                                                                                                                                                                      |
| Rollback                                                     | Revert. The gate check never left, so reverting restores the previous boundary exactly.                                                                                                                                                                             |

## Review-response log

### UX panel (on 1c-3, 2026-10-29) — 6 BLOCKING

B1 proxy loop · B2 copy/lockout · B4 what sign-out clears · B5 no server `signOut` · B6 screenshots —
**all accepted**, §§ 2, 3, 4. **B3** (does Google re-present a chooser after sign-out) stays **open**:
the copy is predicated on _"more than one account"_ and Google does show a chooser with ≥2 sessions,
so it is honest for the audience it addresses. It needs a real multi-session browser, which no harness
here can produce — said plainly rather than left as "the probe is unrun".

### Security panel (round 1) — 3 BLOCKING, 5 SHOULD

| #   | Critique                                                                                              | Verdict                        | Resolution                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| B1  | A swap leaves the gate in middleware alone; the claim-correction prerequisite buys this chunk nothing | **accepted**                   | The AND; acceptance rewritten; `1c-4`-before-`1d` recorded |
| B2  | No harness can render, screenshot or axe the control                                                  | **accepted**                   | § 4's placeholder + a manual runbook step                  |
| B3  | No privacy-inventory update in the chunk where Clerk starts holding real data                         | **accepted**                   | File table                                                 |
| S4  | The limiter refusal has no envelope, copy or observability, and no test can fail                      | **accepted**                   | § 6                                                        |
| S5  | The export route stays unthrottled against `tech-debt.md`'s own text                                  | **deferred, recorded**         | Out of scope, with the entry amended in this PR            |
| S6  | `requireSession()` drops the deep link; restoring it is the first user-controlled redirect            | **accepted (accept the loss)** | § 7                                                        |
| S7  | `actor: 'gate_session'` becomes false                                                                 | **accepted**                   | § 7, constant only, no id                                  |
| S8  | `force-dynamic` is a security property, justified as a test artifact                                  | **accepted**                   | § 1                                                        |

### Correctness panel (round 1) — 5 BLOCKING, 3 SHOULD

| #   | Critique                                                                       | Verdict      | Resolution                                          |
| --- | ------------------------------------------------------------------------------ | ------------ | --------------------------------------------------- |
| B1  | Same harness blind spot, from the test side                                    | **accepted** | § 4                                                 |
| B2  | Acceptance bullet 1 false; deleting the `/gate` links strands a mandatory door | **accepted** | § 3 — the copy states the AND and keeps both routes |
| B3  | The proxy deletion reds two e2e cases and falsifies four rationales            | **accepted** | § 2's collateral list + the file table              |
| B4  | No file table; `write-path.md` owns `actions.ts` so the guide gate fails       | **accepted** | Added                                               |
| B5  | The limiter is `unconfigured` under test, so a misplaced call is invisible     | **accepted** | § 6                                                 |
| S6  | The plan cited `@clerk/nextjs@7.9.15`; installed is **7.9.19**                 | **accepted** | § 4 — conclusion verified at the installed version  |
| S7  | The headline e2e case names a precondition the harness cannot establish        | **accepted** | Risks table — reworded to what is provable          |
| S8  | The exact test edits, and `:52`'s escape predicate must not narrow             | **accepted** | File table                                          |

### ID-1's six keep-open items

| #   | Item                                                     | This chunk                                                                           |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | The principal is a login, never a profile                | ✅ No column ties a profile to a login; nothing touches `profiles`.                  |
| 2   | Every access decision goes through `getHouseholdScope()` | ✅ Untouched — this chunk adds an authN check and resolves no household differently. |
| 3   | State D (two memberships throws) is a Beta 0 invariant   | ✅ Untouched.                                                                        |
| 4   | Nothing pins an athlete to a household                   | ✅ No key, index or cache key added.                                                 |
| 5   | No age-based permission logic                            | ✅ None.                                                                             |
| 6   | Household roles stay a shared const + CHECK              | ✅ Untouched.                                                                        |

## Open questions

1. **B3 — the Google account chooser.** Needs a real multi-session browser; no harness can produce
   one. The maintainer now has two Google accounts in one profile, so it is answerable out of band.
2. **Does `proxy.test.ts` pin the deleted branch?** Settled at implementation; listed so it is not
   discovered by a red CI run.
