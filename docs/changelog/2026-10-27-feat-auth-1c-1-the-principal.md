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
  **Two fresh review lenses found two P1s and the fixes are in this PR**, both of which would have
  been expensive to reopen inside the one-way-door diff. 🔴 **The headline limiter test could not
  fail.** Its mock discarded the policy (`static slidingWindow = () => ({})`) and was a pure function
  of the identifier, so a regression that built _both_ limiters from one shared policy passed it — a
  probe confirmed the shipped and bugged implementations produced identical results. The mock is now
  stateful and policy-aware, the proof is "exhaust one limiter and the other still allows", and a
  second assertion pins the consts to the constructed instances, which is the only thing that can
  detect the wrong policy at all. Both go **red** under the regression.
  🔴 **And the bare `catch` swallowed two errors Clerk deliberately rethrows**: Next's
  prerender-bailout signal (`DYNAMIC_SERVER_USAGE`), which would have turned _"this route must render
  dynamically"_ into _"there is no session"_ baked into a cached output; and `ClerkUseCacheError`,
  which exists to be loud and would have become a silently cached `null`. Now `unstable_rethrow` —
  Next's own list, so the set is not hand-maintained — plus the global-registry symbol, which is the
  only honest detector since `ClerkUseCacheError` is not exported from any public entry at 7.9.15.
  Also fixed from the same reviews: the Redis key was **double-prefixed**
  (`mat-plan:mutate:mutate:<userId>`) and the test pinned the wrong shape; the docblock's claim that
  separate prefixes mean the windows _"cannot collide"_ was **false** (`mat-plan:*` is a parent
  namespace of `mat-plan:mutate:*`); a type assertion hid a **module-load crash the live gate would
  have inherited** from dark code, now a compile error; § Design 1's third mandated property — the
  tagged Sentry capture in the `catch`, bounded to once per process so an unauthenticated prober
  cannot drain the quota — had been dropped silently and is restored; and the claim that _"Clerk's SDK
  populates `event.user`"_ was **false at the pinned version** (zero `sentry` hits across
  `@clerk/nextjs/dist`), so the comment now says what it is: closing a path before anything takes it.
