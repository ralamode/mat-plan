- **2026-11-03** — 🔴 **The published privacy notice told people Google was "not yet" while they were
  signing in through it.** `notice.md`'s Google row read _"Only if you sign in with Google, and not
  yet"_ — false since `AUTH-1` 1c-3b made a session required at every entry point on 2026-11-01, and
  contradicted by two lines of the same document (_"how you get in from 1 November 2026"_ and the
  Clerk row's _"sign-in is switched on"_). It now says **signing in uses Google and it is the only way
  in** — the conditional went too, because Google is the only strategy on the production instance
  (verified 2026-10-29) and _"only if you sign in with Google"_ implies a second door that does not
  exist.
  ⚠️ **The evidence document was stale in the same place, which is how the notice got there.**
  `data-inventory.md`'s Google row still read **"not wired · Planned by `AUTH-1` 1c"**. The Clerk row
  beside it was corrected when 1c-3b shipped; this one was missed — and the notice is derived from
  this table, so one missed cell became a false statement in a published document about a third-party
  data flow. Both corrected here, and the cell records that it was missed rather than quietly
  flipping.
  📌 `notice.md` is a **generated source**: `apps/web/lib/privacy/notice-content.ts` is regenerated
  with `pnpm --filter web privacy:generate`, and a byte-exact drift test fails when the two disagree —
  **proved RED** against a one-word desync before shipping.
  🔴 **Reviewed, and one cell was the smallest of six.** A privacy lens and a trust/reader lens both
  held the merge on the same line: `notice.md`'s _"If you would rather not have an account, say so and
  **the shared code keeps working for you**."_ That offered a parent a Google-free path that stopped
  existing on 2026-11-01 — the most consequential sentence on the page, since it answers the exact
  question a consent screen sends someone here to ask, and a parent who declined on its strength would
  find out at the door. Both lenses noted it is the same defect this PR was written to fix, 115 lines
  below the line it fixed.
  ⚠️ **And a bolded claim that nothing leaves your browser.** The "No tracking" paragraph still read
  _"with sign-in switched off nothing of it runs and no request leaves for anyone else"_ — eight lines
  under the corrected row, and a stronger false statement than the one that prompted the PR. Now
  present tense: everyone passes through the sign-in screen, so Clerk and Google see an IP and a
  browser there.
  Also corrected: _"there is no per-person login yet"_ (false — each adult signs in as themselves; the
  **code** is the shared part); the Upstash row's _"your IP address **only**"_, false since `1c-1`
  added a Clerk user id as a rate-limit key and flagged in the inventory in red but never in the
  notice; four more future-tense sign-in claims in the export, deletion and "what is changing"
  sections; the retention table's missing sign-in-session row; and the sign-off date, which vouched
  for 2026-10-26 under a 2026-11-03 banner while the notice's own re-review trigger (_"sign-in goes
  live"_) had fired unanswered.
  🔴 **The wording of the fix itself was over-reaching.** _"It is the only way in"_ conflates _the only
  sign-in method_ with _the only thing protecting the data_ — and the access code is still required
  until `1d`. It now says **the only sign-in method offered**, which is exactly the inventory's claim
  and no wider; the inventory says "strategy" and the notice had generalised it. The row also now
  leads with Google as subject, matching every other row in a table whose column is _"what they get"_.
  🔴 **`SIGN_IN_COPY.processor` said the one thing the runbook forbids, on the consent screen.** It
  read _"tells us the email address on your Google account — **nothing else from it**"_. False at the
  token: production's scopes are `openid` · `userinfo.email` · `userinfo.profile`, and
  `userinfo.profile` **cannot be removed**, so name and picture arrive regardless. `runbooks.md`'s
  closed scope box carries the prohibition verbatim — _"Do not reintroduce a flat 'Google sends us
  nothing but an email address' — it is false at the token and falsifiable by anyone who looks"_ — and
  `notice.md` was corrected for it on 2026-10-26 while this string, the one a person actually reads
  before deciding, was missed. It now separates **what Google sends** from **what this app stores**.
  📌 **A gate caught me putting an engineering placeholder in front of a parent.** The first draft of
  the retention row used the `⏳` idiom; `notice-content.test.ts`'s zero-placeholder gate reddened it.
  That idiom belongs in `data-inventory.md`, which is where the owed Clerk-retention window is now
  tracked (§8) — the notice states what is known and says to ask for the rest.
  Also: the inventory's un-gated-route table said **two** routes and cited a symbol that moved — it is
  three since `1a` (`/sign-in` owns its subtree via `PUBLIC_PATH_TREES`), and `/sign-in` is the **only**
  un-gated route that reaches a third party. The notice already said three, so the published document
  was ahead of its own evidence. _(privacy + trust lenses, 2026-11-03.)_
  🔴 **A third review round found a production fact nobody had written down: Clerk's script loads on
  the PUBLIC pages, including the privacy notice itself.** `app/layout.tsx` renders `<ClerkProvider>`
  conditioned on the **keys**, not the **path**, so `clerk.browser.js` ships on every route. Measured,
  not inferred — `curl -sL https://mat-plan.dev/privacy` carries the script tag, and so does the
  landing page. **So a stranger who opens the privacy notice and nothing else has their IP seen by
  Clerk, and by Cloudflare which fronts that hostname, because they read the privacy notice.** Both
  versions of the "No tracking" paragraph were wrong about this — the old one and the one this PR
  wrote. It now says so plainly, and `tech-debt.md` carries the fix (scope the provider to the routes
  that need it; `/` and `/privacy` need nothing from Clerk). Disclosure is the floor, not the fix.
  ⚠️ **Three more of this PR's own new sentences were false, all verified against the code:**
  _"ask, and it is done directly in the database"_ — soft-deleting a `household_members` row removes
  no access at all, because the resolver is not membership-derived until `1c-4`; _"the record of who
  did something is per-person"_ — there is **no actor column** anywhere (`created_by|author_id|
member_id|logged_by` → 0 matches) and `userId` appears **0 times** in any Server Action; and
  _"everyone who uses this app goes through Google"_ — contradicted three times by the Children
  section, since a child never signs in. The subject is now scoped to **signing in**.
  📌 **Two more gates earned their keep.** The notice's renderer rejects inline code spans, so
  `clerk.mat-plan.dev` ships as plain text — a document for parents carries no backticks by design.
  And a malformed three-column table row passed `format:check` silently; prettier does not pad a
  missing cell. _(correctness lens, 2026-11-03.)_
