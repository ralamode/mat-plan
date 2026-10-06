- **2026-10-06** — **SEC-5 has a plan: the production audit becomes a gate instead of something that
  happens on a laptop.** [`docs/plans/sec-5-verify-in-ci.md`](../plans/sec-5-verify-in-ci.md). The bug
  is small and the exception mechanism is the work: an advisory can be published against a dependency
  nobody touched, which turns **every** open PR red through no fault of its author — and a `high` whose
  patched version was **never published** would wedge `main` permanently. That is not hypothetical:
  drafting this found that **`braces` was prod-reaching until 2026-10-03**, when moving `shadcn` to
  devDependencies cleared it, and the fragment from that week records exactly the state a naive gate
  would have met. So the design is an **expiring, self-invalidating allowlist**: every entry needs a
  reason, a tech-debt pointer and a ≤90-day expiry, warns on every run, and **fails** once it expires,
  goes stale, or the advisory is re-scored. A `ci-skip-audit` label is rejected with reasons — that
  idiom is right for _scope_ claims and wrong for suppressing a live vulnerability. The guard also
  refuses an **incoherent** report rather than reading it as "nothing found", because a gate that goes
  vacuous after an output-shape change is worse than no gate.
