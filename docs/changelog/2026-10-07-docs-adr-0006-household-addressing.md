- **2026-10-07** — **ADR 0006: household addressing is argued and proposed, not decided**
  ([ADR](../decisions/0006-household-addressing.md)). The question that gates `TEN-1` and `AUTH-1`,
  and therefore the whole Beta 0 critical path, now has a document instead of a line in a milestone
  table: does a household appear in the URL, or only in the session? It recommends **session-only**
  with `/p/<profileId>` kept as the address, settles **404 (never 403) on a wrong household** — and
  narrows `.github/SECURITY.md`'s "403 on wrong household" to `/v1`, in this PR, so the two rules stop
  reading as a conflict. The load-bearing rule holds under every option: **a URL segment is an input,
  never a credential**, so a path segment buys no authorization step and adds a second id that must
  agree. It measures what [HH-1](../plan.md#hh-1) asserted (the counts live in the ADR and are
  deliberately not copied here) and sources the two prior incidents in that class. **The decision box
  is unsigned:** it reverses a decision the maintainer made, so it is the maintainer's call, and
  `TEN-1` is its chunk 0.

- **2026-10-07** — **Option A is signed: session-only, `/p/<profileId>` stays the address.** _(the
  maintainer.)_ [ADR 0006](../decisions/0006-household-addressing.md) moves to **Accepted**, HH-1's
  path clause is superseded (only that clause), and **TEN-1 is unblocked** — it is the next step on
  Beta 0's critical path. Both of the ADR's open questions are closed: the decision itself, and the
  seed-id rotation, which is filed as its own row (**SEC-6**) rather than folded into AUTH-1, because
  it is live today and independent of addressing. The ADR also gains a **forward-compatibility**
  subsection: three enhancements captured under "Later" (`PUB-1`, `SHARE-1`, `SOCIAL-1`, alongside the
  existing `COACH-1`) turn out to exert one pressure rather than four — each needs the seam to express
  _"not mine, but I may see this much of it"_ — so TEN-1 keeps `HouseholdScope` a capability rather
  than a tenant id, phrases its isolation proofs to allow an explicitly published projection, and
  gives the 404 rule an exception clause. ⚠️ **None of that is scope**: none of those rows is in Beta
  0, and none of them argued for a household path segment, since a public or shared surface needs its
  own unauthenticated namespace under either option. They are written down only so TEN-1's shape does
  not foreclose them by accident.
