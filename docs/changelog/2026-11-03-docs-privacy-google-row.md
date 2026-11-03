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
