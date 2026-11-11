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

## Two questions are escalated rather than answered

**Whether the prescription identity earns its place on the wire at all.** It changes an outcome only
when one day holds two prescriptions for the same movement — warm-up and working sets of the same
lift. None exist today; the schema permits them; the export's own docblock anticipates them. That is
a decision about what the CSV should say, so the panel records both costings and leaves it.

**Whether an aged-out athlete's history changes the backfill rule.** For the class the divergence
table was missing, chunk 3 would freeze `''` as that athlete's entire history, permanently.

🔴 **The panel's first draft simply overruled this, and a fresh review caught it.** It instructed
chunk 3 to leave those rows NULL — reversing spec **R1**, a pushback already raised and **declined**
with its reasoning recorded (_"`''` makes NULL mean one thing — never backfilled"_). A panel has no
standing to overturn a decision of record, and the amendment said "accepted" where it should have
said "escalated". Both are corrected; the question goes to the maintainer with the two facts that
bear on it.
