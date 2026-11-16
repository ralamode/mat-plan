- **2026-11-16** — **FAM-1: a new item named only "S" is told "Give the item a longer name."**
  ([contract](../features/program-contract.md) invariant 15). The sentence was "Give the item a name
  with a letter or a number in it", which is wrong for the only names that reach it: a name made of
  the letter `s` alone has a letter, and is refused because the "same movement" rule drops a lone
  `s` and has nothing left to match on. Wording chosen by the maintainer. The message is
  `NEW_ITEM_NAME_MESSAGES.noKey` in `@mat-plan/shared`; the item picker's form shows it as it is.
  Found by the builder lane after step 9. No schema or stored data changes; no new dependency.
