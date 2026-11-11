---
id: V1-22
pr: pending
---

## The chunk-2 contract, after six lenses found four blocking defects in it

`docs/plans/v1-22-2-renderer-and-writer.md` was merged with its review-response log unfilled — the
section says in its own words that `plan-with-panel` fills it **before any implementation code is
written**. This runs that panel: the five standing engineering lenses plus a single UX reviewer, and
records sixteen amendments.

🔴 **The convergence is the part worth keeping.** Four lenses independently caught the same false
premise, three independently arrived at the same structural fix, and two each found the missing
file, the unprovable `''`, the e2e that cannot fail and the allowlist that contradicts the plan's
own code. A defect four readers find separately is not a matter of taste.

## What would have shipped

- **The identity would never have reached the form.** `ProgramDayDTO` is narrowed to `ScaffoldRow`
  by an explicit destructure in a file the plan's table did not list — seven layers of plumbing,
  dropped at the eighth.
- **The headline proof could not have been written.** Acceptance 11's row test needs both composers,
  and one of them is unexported, `async` and `server-only` in another package.
- **Every `open()` prescription could have silently stored NULL.** That is 11 of 13 live
  prescriptions, and three one-word mutants produced it with the whole suite green — including the
  e2e, which by acceptance 11 emits identical bytes either way.
- **History would have moved under the reader.** NULL rows re-run the live fallback at every export,
  so chunk 4's first edit rewrites the `prescribed` cell of every hand-typed movement, every touched
  card and every day-role flip — with no signal. The writer now freezes whenever a day role is
  asserted, and NULL comes to mean only "logged before chunk 2".

## Two questions were escalated, and both are now decided

**Whether the prescription identity earns its place on the wire — dropped** _(maintainer,
2026-11-11)_. It changed an outcome only when one day holds two prescriptions for the same movement
— warm-up and working sets of the same lift — and none exist. The writer matches on the internal
`movement_id` it has already resolved, which is also what `PICK-1`'s invariant 7 schedules a later
PR to switch the drafted slug compare to. **The PR now touches no UI file at all**, which answers the
plan's own open question about owing a UX panel: it does not.

**Whether an aged-out athlete's history changes the backfill rule — it does not** _(maintainer,
2026-11-11)_. Spec R1 stands: chunk 3 writes `''` for ambiguous and unmatched rows. The consequence
— that a backfilled `''` makes permanent a loss which is reversible today — is recorded against the
prerequisite `programming.md` invariant 8 already names for ever making `kind` editable, which is
where it belongs. It is latent, not live: `kind` is not editable by decision.

🔴 **The panel's first draft simply overruled this, and a fresh review caught it.** It instructed
chunk 3 to leave those rows NULL — reversing spec **R1**, a pushback already raised and **declined**
with its reasoning recorded (_"`''` makes NULL mean one thing — never backfilled"_). A panel has no
standing to overturn a decision of record, and the amendment said "accepted" where it should have
said "escalated". Both are corrected; the question goes to the maintainer with the two facts that
bear on it.
