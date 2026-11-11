---
id: V1-22
pr: pending
---

## What was prescribed is frozen when the set is logged, so editing a program stops rewriting history

`entries.prescribed_snapshot` shipped dark in chunk 1 — nothing wrote it, nothing read it. So the
CSV's `prescribed` column was still reconstructed from **today's** program at export time, which is
safe only while prescriptions are seed-immutable. Chunk 4 makes them editable; without this, its
first edit silently rewrites the `prescribed` cell of every historical month.

## One renderer, and why that is structural rather than tidy

`packages/shared/src/csv/prescribed.ts` holds the rendering **and** the live-match composer, and
both the log-time writer and the export call them.

🔴 **The composer used to be inline in a private `async` function inside the `server-only` DAL**, so
`packages/db` could not reach it — which meant "the frozen path and the live path agree" was a claim
a test would have had to make, and the test the plan specified could not have been written at all.
It is one function with two callers now. The ambiguity rule (a movement programmed twice in one day
renders empty, never an arbitrary pick) got its **first** test in the process; nothing had exercised
it since V1-13b.

## The writer freezes whenever a day role is asserted

Leaving NULL on a miss is not "degrades to today's behaviour" once chunk 4 lands: a NULL row re-runs
the live fallback at every export. That is not an edge — it is every hand-typed movement, every card
whose name was touched, and every day-role flip. Freezing what the live path would have emitted at
that moment makes the row stable, and leaves **NULL meaning exactly one thing: logged before chunk
2, or logged with no day role.**

A session logged as "Not a programmed day" takes no snapshot at all, because the legacy fallback
keys on `sessions.day_role` and emits empty for the whole session.

## Two one-word guards carry the chunk, and both resist a tidy-up

The insert spreads on `!== undefined`; the export resolves with `??`, never `||`. An `open()`
prescription renders `''` — **11 of the 13 seeded** — so either truthiness check collapses the
dominant shape to NULL and sends those rows back to today's program.

`db:verify` stores `''` through the real writer and reads it back, asserting both the value and that
it does **not** satisfy `IS NULL`; committed mutation `34` proves that proof can fail. The export's
`??` lives in a pure module with its own test, because a probe showed the equivalent mutation at the
writer is harmless — the fallback there _is_ `''` — so only one of the two sites actually needed the
protection, and it was the one with no test.

## What the panel's rulings removed

The identity was dropped from the wire (plan D1), so the match is on the internal `movement_id` the
writer already holds. No UI file changes, no wire schema change, no scaffold widening.

⚠️ **On the `prescribed` bytes being unchanged, stated accurately.** An earlier draft credited the
export's determinism test; that test compares two exports under the SAME code and could never
witness a difference between branches. The real argument is narrower: the fallback key moved from
`movements.slug` to `movement_id`, and the two can only disagree where a household-owned movement
row is shadowed by a global one sharing its slug. Production has **zero** household-owned movements
(census 2026-10-13, `docs/plan.md`) and the catalog seed has not changed since — a dated zero, which
`plan.md` itself says is not an invariant. The condition that would end it is the seed adding a slug
a household already owns.
