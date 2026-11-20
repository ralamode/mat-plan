- **2026-11-19** — **A library movement's equipment and secondary muscles are listed in one fixed
  order** (CAT-3, [spec](../specs/cat-3-movement-library.md) K31; [guide](../features/program-contract.md),
  invariant 19). `catalogOptionOf` now returns both in the vocabulary's order (`EQUIPMENT`,
  `MUSCLES`) whatever order the entry was written in, through `equipmentInOrder` and
  `musclesInOrder`, which the option read will call too. The maintainer chose that order on
  2026-11-19. On the library of 587 entries, 19 list equipment in another order, so those rows word
  what a movement needs differently than before; 90 list secondary muscles in another order, which
  no screen shows. Aliases keep the entry's order. The spec also records two more things. K29: the
  library a test database reads is worked out from the database itself, with no setting, and
  production cannot read the test library. The launch gate's library half is met: 587 entries on
  `main` in thirteen batches, and the household's list is covered.
