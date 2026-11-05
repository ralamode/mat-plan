- **2026-11-05** — 🔴 **The shared access code is gone: the boundary is a Clerk session with a
  household membership, and nothing else** (`AUTH-1` **1d**, PR A —
  [plan](../plans/auth-1d-retire-the-gate.md)). `lib/access-gate.ts`, `lib/dal/gate.ts`, `app/gate/`,
  `e2e/login.ts`, `e2e/gate-prefetch.spec.ts`, `ACCESS_GATE_PASSWORD`, `GATE_COPY`, `GATE_RATE_LIMIT`
  and the `mp_gate` cookie are deleted. **This is the point of no easy return** — the secret leaves
  `lib/env.ts`, which validates at import, so a revert does not boot until it is restored.
  `1c-4` is what made it safe: before the scope resolver read `household_members`, a session meant
  only "someone this Clerk instance admits", so deleting the gate first would have **widened** access.
  ⚠️ **Dropping a conjunct narrowed the CHECK, not the boundary.** The gate was a SHARED code —
  anyone holding it could use it, so it never identified a caller. Removing it removes a deterrent,
  not an authorization step; that is recorded at each call site, because "half a security predicate
  was deleted" is the reading to pre-empt.
  🔴 **The proxy now enforces NOTHING, and that is literally true for the first time.** The gate
  bounce was the one thing this layer enforced itself. SEC-1's lesson is why it was never the boundary
  even so — a matcher condition decides whether the code runs _at all_, and any client can shape a
  request to dodge one (SEC-1's scar was a prefetch header). The matcher **body** is unchanged; its
  justification is rewritten, from "this decides whether the gate runs" to "`auth()` must be able to
  answer and the headers must land". Clerk consequently runs on all matched traffic rather than a
  pass-through path — required, because `auth()` throws when `clerkMiddleware()` did not run and
  `/sign-in` is now the only way in, so its whole subtree must work.
  **The `mp_gate` tombstone** clears the retired cookie for anyone still holding one. It appends a
  literal `set-cookie` header rather than calling `response.cookies.delete()`, because mutating
  `ResponseCookies` re-emits the whole parsed bag keyed by name alone — on the response that
  establishes a session, that can mangle `__clerk_handshake`. It takes and returns `Response`, not
  `NextResponse`, because `clerkMiddleware`'s auto-proxy branch returns a plain one; `proxy()`'s
  return type widens for the same reason rather than re-telling the lie that cast already tells.
  Removable 2027-02-04 ([tech-debt](../tech-debt.md)).
  🔴 **Two runtime auth proofs went with the gate, and this is a real loss, stated rather than
  absorbed.** The harness arms a principal in the **process environment**, so no browser context in
  the suite can be unauthenticated — which did not matter while the proxy bounced a cookie-less
  request. `landing.spec.ts`'s unauthenticated-action proof loses **variant 1** (its only protection
  _was_ that bounce; the action now genuinely runs), "the app itself is still gated" is deleted rather
  than repointed, and `export-csv.spec.ts`'s fresh context is now **theatre** — the file says so.
  Production is still protected by the in-process `requireSession()`, unit-proved; what is gone is the
  **runtime** proof. ⚠️ Do not cite _"no unauthenticated request does DB work"_ as a property of this
  suite any more — `ai-1-nl-logging.md`'s spend argument did, and both halves of that evidence
  vanished in one diff. The un-bypassed second server that would restore it is specified, and
  deliberately not built, in [tech-debt](../tech-debt.md).
  🔴 **SEC-1's regression is pinned by matcher SHAPE, on the COMPILED entry.** The obvious
  `config.matcher.every((m) => typeof m === 'string')` is a **type-level tautology** — `config.matcher`
  infers as `string[]`, so it is unconditionally true in any tree that typechecks and only appears to
  probe red because Vitest does not typecheck. A header condition requires an object entry, so
  `getMiddlewareMatchers` is what can see it. ⚠️ After `1d` that regression fails **quietly**: `auth()`
  throws when the proxy did not run, which an e2e spec reads as "redirected to sign-in" and passes.
  ⚠️ **`pages-are-gated.test.ts`'s allowlist is EMPTY, and `it.each([])` registers no tests** (probed,
  Vitest 5.0.5, no warning) — so `expect(ALLOWLIST).toEqual([])` keeps the emptiness asserted rather
  than merely true. The dead-entry assertion is what forced the gate action's entry out with the file.
  🔴 Narrowed to one conjunct, **never widened to an alternation**: that file's own rule is that a
  regex accepting either helper proves neither, which is why the gate conjunct was deleted rather than
  folded into an `||`.
  **Privacy — two changes, in opposite directions, both recorded in
  [notice.md](../privacy/notice.md)'s new dated section and
  [data-inventory.md](../privacy/data-inventory.md)'s §4 / §7 / §8 re-read.**
  ✅ **Upstash stops receiving a client IP entirely** — the gate's was the app's only IP-keyed limiter,
  and it existed solely to bound guesses at the shared code. That is the **first entry in the re-read
  log recording a REDUCTION in what a processor receives.** ⚠️ Not purely a reduction in sensitivity:
  an IP is about a connection, a Clerk id is about a person and is stable across devices.
  ⚠️ **And one thing the chunk makes plainer rather than smaller:** sign-up is invitation-only, but
  Google's consent screen runs **before** the invitation is checked — so a refused address has already
  given Clerk its email, name and picture. The notice now says so, and says such a record can be
  deleted **without** being invited to anything. ⏳ Whether a refused sign-up leaves a Clerk record at
  all is still unobserved (the plan's lit-panel finding 5).
  ✅ **`/privacy` is indexable** _(maintainer, 2026-11-05)_. The committed reason for `noindex` was
  that publishing a description of a lock whose limiter could fail open was a gift to a scanner — and
  `1d` does not **arm** that limiter, it **deletes** it along with the lock, so the premise is
  dissolved rather than satisfied. A privacy notice search engines cannot see is of limited use to the
  people it is written for.
  ⚠️ **Three byte-exact notice pins were repointed, and one could not simply be re-quoted.** The
  depth probes for an `ol` item and a `dl` description moved to surviving text at the same depths
  (losing one silently narrows the flattener's coverage — what let PRIV-1's placeholders through).
  🔴 The third was `"That follows from (1) and (2)"`, whose **premises changed underneath it**: the
  derivation is rewritten to name them in words, because keeping the string would have passed while
  the sentence it quoted was false. All three were probed RED.
  **`.github/SECURITY.md` carried three claims `1d` falsifies**, two with no symbol to grep. It said
  _"the rate limiter is wired to the gate login only, so a gate-code holder can still mint unbounded
  `movements` rows"_ — false in the **safe** direction, so leaving it would tell a reader a live
  minting primitive exists. It listed **"auth"** first among rate-limited surfaces, and `1d` deletes
  the only auth limiter: **this repo now rate-limits nothing on the authentication path**, which is
  stated rather than implied. And its cookie row claimed three CSRF layers from the gate's cookie;
  the honest count is **two and a vendor default** — this app sets one cookie (`tz`), and
  `@clerk/shared@4.41.0`'s handler sets no `sameSite`, so a client-written Clerk cookie takes the
  browser default. ⏳ A dated production `Set-Cookie` dump capturing **`SameSite`** is owed; an earlier
  instruction said `httpOnly`, which would have measured the wrong attribute. `AGENTS.md`'s identical
  rate-limit line moved in the same PR, so the two cannot disagree.
  ✅ **`write-path.md`'s own note asked `1d` to reconcile ~a dozen copies of the auth claim, and it is
  done** — `SECURITY.md`, `AGENTS.md`, `security-reviewer`, `review-pr`, `add-server-action`,
  `export-csv.spec.ts`, the export handler, `runbooks.md`, `status.md` and `ai-1-nl-logging.md` (a live
  design doc, not history). ⚠️ Dated plans and changelog fragments are **not** rewritten, so a grep
  for the old claim still finds them — policy, not oversight.
  ⚠️ **`runbooks.md`: "Rotate a secret" takes the `CLERK_SECRET_KEY` rotation as its worked example**
  — a procedure that has actually been performed, because it fixed a live production sign-in loop. The
  diagnostic is worth keeping: a correctly-shaped `sk_live_…` key still produced
  `clerkReason: "unexpected-error"`, so checking the prefix does **not** distinguish the two;
  regenerating is the test. The gate's rate-limit verification procedure is rewritten for the mutation
  limiter and now says plainly that 120 writes in 5 minutes **cannot be checked by hand**.
  🔴 **And a conditional written as a fact is a finding generator.** `runbooks.md` said _"an
  unrestricted instance **means** Clerk holds uninvited people's email addresses"_ in the present
  tense, with its disposition recorded nowhere — and **two independent readers** reached the same
  false P0 straight from that text, one mid-panel. It is now past-conditional, with the dated
  disposition beside it: the production Users list holds two accounts, both the maintainer's own.
  **Also:** `isRateLimitConfigured` is rebound to `mutationLimiter` (the module would not compile
  otherwise, and `ai-1-nl-logging.md` cites it as a live mitigation); `generate-privacy-notice.test.ts`
  would have gone silently **vacuous** — `not.toContain(process.env.ACCESS_GATE_PASSWORD!)` becomes
  `not.toContain(undefined!)`, so it owns a fixture secret now; `.gitleaks.toml` **keeps** both
  allowlisted strings, because they survive in `docs/lessons.md` and two plan docs and deleting the
  entries would turn gitleaks red; and the `/gate` readiness probe in `ui-screenshot/SKILL.md` and
  `playwright.config.ts` would have spun to its timeout against a 404.
  🔴 **One operator action is owed and is the only thing left:** `ACCESS_GATE_PASSWORD` out of Vercel
  (all environments) and `.env.local`. Nothing reads it, so leaving it set breaks nothing — which is
  exactly why it will be forgotten.
