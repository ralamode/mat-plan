- **2026-10-01** — **V1-30a: every unit the strength form offers now saves and exports** ([plan](../plans/v1-30-loggable-units.md)).
  The server accepted only `lb`/`kg` of the 9 units the Measuring picker offers, so a timed hold or a
  distance failed the whole session (since #141). The export gains app-defined spellings (`85kg`,
  `75cm`, `20m` metres, `40yd`, `3min` minutes) and a `kg` worn mass is suffixed (`BW+8kg (vest)`, not a
  bare 8 read as pounds). BW / band are refused on a time or distance set, one message per fault, naming its
  set by its movement's name (a number would point at the wrong card once untouched scaffold cards
  are dropped). A chain test runs the wired schema field, so the form, server and export can't drift again.
  Filed: V1-30b (form polish), V1-33 (edit non-mass sets), V1-34 (jump/hold defaults), EXP-1.
