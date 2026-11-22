# Tech debt: the seed's session timeouts race its first query

A tech-debt row, from the CAT-3 A2-ii production rehearsal: `scripts/seed.ts` fires its
`lock_timeout` / `statement_timeout` `SET` on connect without awaiting it, which pg 8 tolerates with
a deprecation warning and pg 9 will not. The row names pg 9 as the trigger and the fix.
