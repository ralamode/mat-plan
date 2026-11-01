- **2026-11-01** — **Every entry point now requires a session as well as the access code, and sign
  out exists.** Twelve surfaces — 4 pages, 7 Server Actions, 1 Route Handler — check **both**,
  in-process.
  🔴 **AND, not replace, and the distinction is the whole design.** A draft of this chunk _swapped_
  each gate check for a session check. `getHouseholdScope()` does not consult the principal until
  `1c-4`, so in the window between them a swap would have made the access predicate _"(any valid
  Clerk session on this instance) AND (a gate cookie, checked only in middleware)"_ — and a request
  that bypasses the proxy is refused in-process today. That is not hypothetical here: SEC-1's own
  scar was a prefetch header skipping the matcher, and `SECURITY.md` says in terms that middleware is
  not the auth boundary (CVE-2025-29927). Caught by the security panel on the plan, before code.
  **So `1c-4` must land before `1d`** — recorded in [beta-1](../milestones/beta-1.md) as a security
  obligation rather than an ordering preference, because `1d` is what deletes the gate half.
  ⚠️ **The copy states the AND; it does not delete the gate route.** The same draft removed
  `SIGN_IN_COPY.codeStillWorks` and the `/gate` links, which would have left **nothing in the app
  linking to a door that is still mandatory** — and _"the access code is still the way in"_ is TRUE
  under the AND, so deleting it was the dishonest direction. It now says the code is one of two
  things, as does the gate's own subhead.
  **Sign out clears the Clerk session only.** Clearing `mp_gate` too would bounce the user to
  `/gate` needing the shared code to re-enter **their own household** — and after `1c-4` that reader
  is an invited parent who does not have it. A test pins that the component names no cookie, because
  "sign-out doesn't clear the gate cookie" reads as an oversight and the obvious fix is the lockout.
  It is a **client** component: `@clerk/nextjs@7.9.19` exports no server-side `signOut`, and the
  server-side alternative leaves the `__session` JWT verifiable — hand over the tablet, press Back,
  still signed in, which is what parked #303.
  🔴 **It ships with a provider-free placeholder, and that is a testability control.** Both harnesses
  blank the Clerk keys on purpose, so `clerkIsConfigured()` is false and a `useClerk()` component
  would throw — meaning the control would otherwise ship with **no screenshot, no axe scan and no
  tap-target measurement**. 1c-3a supplied a principal, not keys, and arming real keys would
  permanently destroy `theme.spec.ts`'s one-way zero-egress assertion. The placeholder renders the
  same markup disabled; the live control is verified by hand against the dev instance.
  **The proxy's `authed && (/ | /gate) → /p` forward is deleted.** Once the pages require a session it
  looped for every cookie-holder without one — which is everyone at deploy — and its `/` arm meant
  such a visitor could never see the landing page at all. Nothing security-relevant went with it: an
  unauthenticated caller never reached that branch. Two e2e cases were **inverted** rather than
  deleted, and four committed rationales that cited the forward were corrected with it.
  **The mutation limiter is wired to the principal**, after the session check and **before** the zod
  parse — so an unauthenticated flood costs zero Redis and zero DB work, and the key is never
  caller-supplied. Its refusal has its own copy: reusing `NO_PROFILE_*` would tell a kid mid-session
  _"No profile found to log against"_ and blur the 404-never-403 argument. ⚠️ It needed a **source**
  guard, because it fails open and is `unconfigured` under vitest — a call placed after the write
  would pass every behavioural test. `pages-are-gated.test.ts` now reports each missing conjunct by
  name; both were proved RED by probe.
  **Privacy:** `data-inventory.md` said _"1a holds no Clerk-held personal data"_ and the published
  notice said sign-in was _"not switched on yet"_. Both were true and both are false from this deploy:
  Clerk now holds a user record and sign-in logs for everyone who reaches the app, and Upstash holds
  a **Clerk user id** as a rate-limit key — a new identifier at that processor, since an IP is about a
  connection and a user id is about a person. Corrected in the same PR, including the served
  `/privacy` page.
  Also: `ScopeMissEvent.actor` is `'clerk_session'` — a constant, **never the id**, which would be the
  same cross-tenant linkage the owning household id is forbidden for. `force-dynamic` on the export
  handler is now justified by the **security** reason (a cached CSV under ADR 0006 is one household's
  data served to another) rather than by the source-text test that also happens to accept it.
