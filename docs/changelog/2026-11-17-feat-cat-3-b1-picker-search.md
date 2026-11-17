- **2026-11-17** — **CAT-3 B1: the movement picker finds "bb curl" and offers similar names for a
  misspelling** ([spec](../specs/cat-3-movement-library.md) § Search, P5 and P6;
  [guide](../features/movement-picker.md) invariant 13). The picker's list now reads the library's
  search: an equipment short form finds the movement it stands for, and when nothing matches, a
  **Similar names** section (interim wording; the prototype settles it) lists the near misses above
  "Matches some of your words", with a row in both shown and counted once. The status says "No
  matches." once and counts each list; Enter never picks a similar name; the create button stays
  quiet while anything is listed, and its hint names the closest movement. "Already listed" still
  reads the plain match, so what can be added as typed is unchanged. A source test holds that the
  query never leaves the device. No schema change, no new dependency.
