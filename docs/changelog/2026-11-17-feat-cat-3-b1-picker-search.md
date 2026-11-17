- **2026-11-17** — **CAT-3 B1: the movement picker finds "bb curl" and offers similar names for a
  misspelling** ([spec](../specs/cat-3-movement-library.md) § Search, P5 and P6;
  [guide](../features/movement-picker.md) invariant 13). The picker's list now reads the library's
  search: an equipment short form finds the movement it stands for, and when nothing matches, a
  **Similar names** section (interim wording; the prototype settles it) lists the near misses above
  "Matches some of your words", with a row in both shown and counted once. The status says "No
  matches." once and counts each list; Enter never picks a similar name; the create button stays
  quiet while anything is listed, and its hint names the similar movement. A short form that spells a
  movement is that movement ("bb curl" is Barbell Curls, as the server already says since C30), and
  the two aliases that were equipment short forms, `KB` and `DB bench`, are retired. A row found through another name says "also called …", and Enter does not pick a
  sole match found only through part of another name. The picker sends the query
  nowhere itself (an import allowlist and a source scan), and searching in the item picker runs no
  action until a person taps Create. No schema change, no new dependency.
