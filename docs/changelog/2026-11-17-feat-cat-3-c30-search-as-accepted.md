- **2026-11-17** — **CAT-3: the search lists the best match first, and knows an abbreviation is the movement**
  ([spec](../specs/cat-3-movement-library.md) P1 to P4 and P17; [guide](../features/program-contract.md);
  contract change C30, from the accepted picker prototype). The shared search now orders results
  by how well they answer what was typed: the exact name, then names that start with it, then
  names where a word starts with it, and a match buried in the middle of a word last. It finds a
  movement by part of its other name ("open book" finds Thoracic rotation), lets a four-letter
  word be one letter off when its first two letters match, and treats "db row" as Dumbbell row,
  so the server makes no second copy under an abbreviation. On screen today only the order of
  results in the two existing pickers changes; they take up the rest (abbreviations, other names,
  the close spellings) in the picker lane's next change.
