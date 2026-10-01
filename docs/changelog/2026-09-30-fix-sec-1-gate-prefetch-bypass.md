- **2026-09-30** — **SEC-1: the access gate holds for prefetch-flagged requests**
  ([plan](../plans/sec-1-gate-prefetch-bypass.md)). The proxy matcher excluded requests carrying a
  prefetch header, and any client can send one, so such requests bypassed the gate: a Vercel preview
  served the profile picker and a profile's Today page without the gate cookie. The exclusion is gone,
  and the gate is now re-checked where the work happens: all six Server Actions refuse an un-gated
  caller before any DAL call (with their not-found copy), and the three gated pages redirect to the
  gate themselves (`lib/dal/gate.ts`). Each layer alone keeps the content out (verified by mutation),
  so a future matcher edit can't reopen it. The baseline audit's local probe had seen a 400 here,
  which is why it rated this P1.
