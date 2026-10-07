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
