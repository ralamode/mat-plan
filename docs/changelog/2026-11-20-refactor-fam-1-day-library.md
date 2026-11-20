### Changed

- **The day page reads coach labels from the library in effect** (FAM-1, CAT-3 P11-ii-a follow-up).
  `getDayPlan` hands the resolver `CATALOG_LIBRARY`, the same list the program builder's picker and
  `newItem` read, instead of the built-in movements directly. It is the same list today, so nothing on
  the page changes; once the library comes from the database (CAT-3 K29), the day page follows it with
  no further edit.
