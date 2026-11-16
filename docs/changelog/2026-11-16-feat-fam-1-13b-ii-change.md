- **2026-11-16** — **FAM-1 step 13b-ii: a logged number on the day page can be changed in place,
  with Undo** ([plan](../plans/fam-1-family-program.md) §5's 13b-ii row, D20;
  [guide](../features/day-page.md)). On the preview route; 12d wires it to the real `amendRow`. On
  today and yesterday, a logged set's load and reps, and a single row's number, are green-edged
  fields. Focus selects the whole number, Escape or Cancel puts it back, and the row is saved when
  focus leaves it, on Enter, or on its ✓. While a number is typed over, the field drops the logged
  look and the row says "Not saved. Was 30 lb.". After a save, "Changed 27.5 lb → 30 lb" with Undo,
  which returns the numbers from before the first Change this visit (maintainer, 2026-11-16). A
  blank or non-number keeps that field's number and says so; a failed save keeps what was typed,
  offers Try again, and counts as not saved. On an iPhone, a ✓ tapped during an edit saves it and never un-ticks the set. A row
  logged in another unit than the item's stays text, so a load is never re-sent in the wrong unit.
  Every row, Change or not, now holds what this visit wrote until the page's data shows it, even
  when a write comes back with the entry's old id (a ✓ after an un-tick), and a set logged again
  elsewhere after an un-tick shows as logged.
  Also: the day page uses the shared whole-number check and item count (#451, #452), and the load
  column is wider so a six-character load fits as a field. No schema change, no new dependency, no
  change to production behaviour.
