# The movement library gets its tables: equipment, muscles and a kind of training

Migration `0032` gives `movements` somewhere to hold what a person will filter by (`CAT-3` A1):

- `equipment` and `muscles`, reference tables of codes seeded from the shared vocabularies;
- `movement_equipment` and `movement_muscles`, a movement's required equipment and its muscles, with
  at most one primary muscle per movement;
- `movements.modality` (strength, conditioning, mobility, skill), which only a library row may carry.

A global movement with no lift pattern is now legal only for a non-strength library row. The tables
are empty until the catalog seed (A2), and nothing in the app reads them until P11-ii. Plan:
[cat-3-a1-catalog-tables](../plans/cat-3-a1-catalog-tables.md).
