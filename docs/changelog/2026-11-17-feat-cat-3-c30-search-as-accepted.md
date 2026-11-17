- **2026-11-17** — **CAT-3: the search lists the best match first, and knows an abbreviation is the movement**
  ([spec](../specs/cat-3-movement-library.md) P1 to P4 and P17; [guide](../features/program-contract.md);
  contract change C30, from the accepted picker prototype). Results are ordered by how well they
  answer what was typed: the exact name, then names that start with it, then names where a word
  starts with it, and a match buried in the middle of a word last ("chin" lists Chin-up before
  Machine-assisted pull-up). Typing part of a movement's other name finds it ("military" finds
  Overhead press). A four-letter word may be one letter off when its first two letters match. And
  "db row" now counts as Dumbbell row, in the picker and on the server, so nobody makes a second
  copy under an abbreviation. The order of results changes wherever the picker is used today; no
  other screen changes yet.
