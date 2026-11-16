- **2026-11-16** — **FAM-1 contract change C12: a program or workout name cannot be made only of
  invisible characters** ([contract](../features/program-contract.md) invariant 17;
  [plan](../plans/fam-1-family-program.md) step 6a). A name made only of zero-width characters is
  one character long, so the contract's name schema took it (since #417), and it would have shown as
  a blank line in the Programs list. A required name must now also fold to something (`foldName`);
  the write schemas answer `invalid`. It is narrower than "can be seen": a few characters that draw
  as blank (the braille blank, the Hangul fillers) are kept by `foldName` and still pass. Found by
  step 6a-i's review, before any real writer or screen could store one. The plan also records that
  step 6a is three PRs (6a-i, 6a-ii, 6a-iii), that 7a waits for all three, and the chart counts 48
  PRs. No production behaviour, schema or stored data changes; no new dependency.
