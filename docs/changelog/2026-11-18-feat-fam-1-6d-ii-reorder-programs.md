# An athlete's programs can be put in their own order

FAM-1 step 6d-ii, lane P: `reorderPrograms`, the writer behind `DayActions.reorderPrograms`. Nothing in
the app calls it yet; step 15c wires it through a program-DAL function.

- The order is the athlete's full list of current programs, as the day page reads them. A stale or
  wrong list is refused as `invalid`.
- `placeAssignments` is now the one writer of the order, shared with Put on. A program ending today
  keeps its row and reads last; a hidden program's open row moves after the listed ones.
- An unchanged order, and a replay, writes nothing.
