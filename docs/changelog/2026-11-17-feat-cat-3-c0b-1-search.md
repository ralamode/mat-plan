- **2026-11-17** — **CAT-3: the movement library's search forgives a typo and knows "db"**
  ([spec](../specs/cat-3-movement-library.md); [guide](../features/program-contract.md); contract
  chunk C0b-1). The search the picker will use: typing "db row" finds Dumbbell row, and when nothing
  matches, a near miss is offered ("dedlift" finds a deadlift). A short form or a near miss never
  counts as the name already being in the list, so a family can still make its own item. No screen
  uses it yet; the picker's own PR is next.
