- **2026-11-16** — **FAM-1: the row writer's verify fixture is exported for other lanes' proofs.**
  `verify/day.ts` exports `programRowFixture(tx)` (and its type), the fixture lane E's 11b proofs build:
  a household with a template block, a prescription of each tracking type and the row writer's helpers.
  Lane S's B2-0 needs a real program row to tick, un-tick and re-tick, and imports it rather than
  copying it. Test code only.
