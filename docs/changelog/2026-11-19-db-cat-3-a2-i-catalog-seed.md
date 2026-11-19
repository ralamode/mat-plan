- **2026-11-19** — **Plan for the code that will write the movement library into the database**
  (`CAT-3` A2-i; [plan](../plans/cat-3-a2-i-catalog-seed.md)): one writer that adds each library entry
  as a shared movement with its equipment and muscles, in one transaction, never touching a row that
  already holds the slug or a row a household owns. Production's seed passes it no entry until A2-ii.
  Hardened by six review lenses and a re-review. No roadmap item moved.
