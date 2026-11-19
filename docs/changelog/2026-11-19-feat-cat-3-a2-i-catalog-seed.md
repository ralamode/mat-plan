# The movement library's database loader, not yet switched on

CAT-3 A2-i, lane P ([plan](../plans/cat-3-a2-i-catalog-seed.md)): `seedCatalog` writes library movements,
with their equipment and muscles, into the database in one transaction. It never touches a row that
already holds the slug, or a row a household owns, and each insert skips itself when it has nothing to
write, so a deploy with every entry already present cannot fail. Production's seed gives it an empty
list until A2-ii, and a proof fails if that changes. `movementIsCatalog()` is the one test for a
library row. The seed's public log now prints counts only, never a slug a household also holds. The
ownership report counts blockers by the database CHECK's own rule, and 17 new mutation patches (502–518) prove
the guards can fail.
