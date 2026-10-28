- **2026-10-27** — **`AUTH-1` 1c lands in four PRs instead of one, and this is the first: the
  principal, fully dark.** 1c as planned was **19 files** across the DAL, seven actions, four pages,
  the export route, a test rename, the rate limiter, Sentry scrubbing and five docs — well past
  AGENTS.md's <400-line target, and it is the **one-way door**. Split by what each piece makes
  reachable: **1c-1** the principal (dark) · **1c-2** the "no household" screen · **1c-3** the call
  sites · **1c-4** the resolver.
  🔴 **The order is the reverse of what the plan implies, and that matters.** The plan lists the
  resolver first; doing that **breaks the app**. If `getHouseholdScope()` switches to membership-based
  while the call sites still check only the gate, every gate-authenticated visitor without a Clerk
  session resolves `null` → an empty picker. Flipped, it is safe: call sites first means a visitor
  must now have a session while the household still resolves the old way, which is correct for Beta
  0's one household; the resolver switches afterwards, by which point everyone reaching the app has
  both a session and a membership.
  **What ships here.** `lib/dal/session.ts` — `getCurrentUser()` (the one `auth()` call, React-cached
  per request), plus `sessionUserOrNull()` for the actions and `requireSession()` for the pages. **One
  module, not two**: the plan's first draft split the principal from the refusals and the panel
  rejected it as a split personality rather than a seam.
  🔴 **It fails closed three ways, and all three are tested**: no keys → `null` and `auth()` is never
  called (with no keys `clerkMiddleware()` never ran, so `auth()` would throw on every request); no
  session → `null`; and **`auth()` THREW → `null`, not a rethrow**. That last one is SEC-1's lesson as
  a test — the matcher is not the boundary, so a route the matcher misses must **refuse** rather than 500.
  **The rate limiter needed a refactor, not a constant.** `Ratelimit.slidingWindow(...)` bakes its
  window in at construction and `checkRateLimit` takes no policy argument — so adding a
  `MUTATION_RATE_LIMIT` const alone would have left the seven actions limited at **the gate's**
  10-per-10-minutes while a sizing test asserted the new number **and passed**. There is now a
  per-policy factory, a second limiter with its own Redis prefix, and `checkMutationLimit(userId)`
  owning the `mutate:` key shape. The proof is behavioural: exhaust one limiter, the other still
  allows.
  **And the identified user never reaches Sentry.** Clerk's SDK and Sentry's Next integration both
  populate `event.user` once a session exists, and the default payload carries an **email** — the one
  piece of adult personal data this app deliberately does not hold (§7: it lives in Clerk, which is
  the point of using Clerk). `event.user` and `contexts.user` are **deleted, not masked** — a masked
  field is still a field somebody can decide to unmask. It lands here, **before any session exists**,
  so there is no window in which an identified event could be sent.
