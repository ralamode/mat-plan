- **2026-10-22** — **A five-lens panel withdrew `1c-pre`'s first draft, and what shipped is a tenth of
  its size.** The draft proposed a test-only session bypass, `@clerk/testing` in CI, a membership row
  in the ephemeral fixture and a combined `login()` helper — eleven paths across three packages plus
  CI. The convergent finding: it **planned the minting of a session and never the accepting of one.** A
  fixture script can set any cookie; unless app code trusts it, `requireSession()` rejects it — and the
  trusting module lands in `apps/web/lib/` and **does not exist until 1c creates it**. Two more
  prerequisites were also absent: `household_members` and `insertHouseholdMember` are **1b's**, and 1b
  has not shipped. So two of four acceptance bullets were unimplementable the day they were written,
  and the rest **could not fail** — pre-1c the gate authenticates in both arms, so a working session
  mint is indistinguishable from a no-op.
  **Two findings would have done real damage.** Putting Clerk keys in the PR-triggered `e2e` job
  destroys [`theme.spec.ts`](../../apps/web/e2e/theme.spec.ts)'s zero-Clerk-egress assertion — the one
  that makes _"1a ships dark"_ a tested claim — and its own docblock says that is **one-way**: once
  `connect-src` names the Frontend API, a live egress produces zero violations by construction. And a
  lit smoke would turn the **public** failure artifacts into a credential leak, because CI uploads
  `test-results` with `trace: 'on-first-retry'` and Clerk's testing token travels as a **query
  parameter**, which traces record. Today the only credential a trace can hold is a placeholder.
  **What shipped is the one piece that is genuinely pre-1c work:** `apps/web/e2e/gate-login.ts` →
  `login.ts`. The export stays `gateLogin` because that is what it drives; the module does not, because
  at 1c it also holds the session half and at 1d the gate half is deleted. A name true in all three
  worlds costs two import lines now instead of a rename inside 1c's one-way-door PR and another inside
  1d's. 🔴 **The rename reds `skills:check`** — `.claude/skills/ui-screenshot/SKILL.md` cites the path
  backticked — so that gate is the acceptance criterion, proved red-then-green by the change itself.
  `AGENTS.md` cites it too and is outside the guard's scan, so it would have gone stale silently.
  Also corrected: the parent plan assigned `household_members` to **migration `0015`**, which TEN-2a
  took. Next free is **`0019`**. And `@clerk/testing`, read at the pinned source rather than its README,
  **defaults to loading `apps/web/.env.local`** and has **no OAuth sign-in strategy** — both carried
  forward to the row that adopts it, rather than discovered by it.
